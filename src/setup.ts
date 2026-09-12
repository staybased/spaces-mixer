import type { ObsClient } from "./obs-client";
import { MUSIC_DEVICE_UID } from "./tap";

export const NAMES = {
  collection: "Spaces Mixer",
  scene: "Spaces Mix",
  music: "Browser Music",
  mic: "Mic",
} as const;

export const KINDS = {
  /** Music comes in through the per-app CoreAudio tap device published by bin/spaces-tap. */
  musicInput: "coreaudio_input_capture",
  micInput: "coreaudio_input_capture",
} as const;
const MONITOR_AND_OUTPUT = "OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT";
const MONITOR_OFF = "OBS_MONITORING_TYPE_NONE";
const DEFAULT_DB = { music: -12, mic: -3 } as const;
const COLLECTION_SWITCH_TIMEOUT_MS = 8000;

export type PropItem = { itemName: string; itemValue: string; itemEnabled: boolean };
export type SetupOptions = { browserBundleId: string; browserRunning: boolean; tapDevicePresent: boolean; micDeviceUid?: string; micNameHint?: string };
export type Logger = (line: string) => void;

export const FILTERS = {
  mic: [
    { name: "Noise Suppression", kind: "noise_suppress_filter", settings: { method: "rnnoise" } },
    { name: "Compressor", kind: "compressor_filter", settings: { ratio: 4, threshold: -18, attack_time: 6, release_time: 60, output_gain: 0 } },
  ],
  // Order matters: Trim first (auto-set by the server), then a gentle compressor so the Space's own AGC has
  // nothing to chase, then a brick-wall limiter. Spaces is mono/Opus; consistent level matters more than punch.
  music: [
    { name: "Trim", kind: "gain_filter", settings: { db: 0 } },
    { name: "Compressor", kind: "compressor_filter", settings: { ratio: 2.5, threshold: -20, attack_time: 10, release_time: 150, output_gain: 0 } },
    { name: "Limiter", kind: "limiter_filter", settings: { threshold: -1.5, release_time: 60 } },
  ],
} as const;
export const TRIM_FILTER = "Trim";

// ---- pure pickers ---------------------------------------------------------

/** Loopback devices must never be the mic: they'd feed the mix back into itself. */
export const isLoopbackDevice = (item: PropItem): boolean => /blackhole|loopback|soundflower|spaces mixer tap/i.test(item.itemName) || /BlackHole|SpacesMixerTap/i.test(item.itemValue);

export type MicPick = { item?: PropItem; reason: "explicit" | "hint" | "first" | "none" | "explicit-missing" };

/**
 * Explicit uid wins. If the explicit uid is not present the pick FAILS (returns explicit-missing) instead of
 * silently grabbing another device. Without an explicit uid: name hint, then first enabled non-loopback device.
 */
export function pickMic(items: PropItem[], uid?: string, hint = "Condenser"): MicPick {
  const usable = items.filter((i) => i.itemEnabled !== false && i.itemValue !== "default" && !isLoopbackDevice(i));
  if (uid) {
    const exact = usable.find((i) => i.itemValue === uid);
    return exact ? { item: exact, reason: "explicit" } : { reason: "explicit-missing" };
  }
  const byHint = usable.find((i) => i.itemName.toLowerCase().includes(hint.toLowerCase()));
  if (byHint) return { item: byHint, reason: "hint" };
  return usable[0] ? { item: usable[0], reason: "first" } : { reason: "none" };
}

// ---- idempotent steps -----------------------------------------------------

async function ensureCollection(obs: ObsClient, log: Logger): Promise<void> {
  const { sceneCollections, currentSceneCollectionName } = await obs.call("GetSceneCollectionList");
  if (currentSceneCollectionName === NAMES.collection) return;
  const changed = obs.waitForEvent("CurrentSceneCollectionChanged", COLLECTION_SWITCH_TIMEOUT_MS);
  if (sceneCollections.includes(NAMES.collection)) {
    await obs.call("SetCurrentSceneCollection", { sceneCollectionName: NAMES.collection });
    log(`switched to scene collection "${NAMES.collection}"`);
  } else {
    await obs.call("CreateSceneCollection", { sceneCollectionName: NAMES.collection });
    log(`created scene collection "${NAMES.collection}"`);
  }
  const ev = await changed;
  if (!ev) throw new Error("OBS did not confirm the scene collection switch");
  // OBS fires the event slightly before the collection is queryable.
  for (let i = 0; i < 20; i++) {
    const now = await obs.call("GetSceneCollectionList");
    if (now.currentSceneCollectionName === NAMES.collection) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`OBS is still not on "${NAMES.collection}"`);
}

async function ensureScene(obs: ObsClient, log: Logger): Promise<void> {
  const { scenes } = await obs.call("GetSceneList");
  if (!scenes.some((s: any) => s.sceneName === NAMES.scene)) {
    await obs.call("CreateScene", { sceneName: NAMES.scene });
    log(`created scene "${NAMES.scene}"`);
  }
  await obs.call("SetCurrentProgramScene", { sceneName: NAMES.scene });
}

async function findInput(obs: ObsClient, name: string): Promise<{ inputName: string; inputKind: string } | undefined> {
  const { inputs } = await obs.call("GetInputList");
  return inputs.find((i: any) => i.inputName === name);
}

async function ensureInScene(obs: ObsClient, inputName: string, log: Logger): Promise<void> {
  const { sceneItems } = await obs.call("GetSceneItemList", { sceneName: NAMES.scene });
  const item = sceneItems.find((s: any) => s.sourceName === inputName);
  if (!item) {
    await obs.call("CreateSceneItem", { sceneName: NAMES.scene, sourceName: inputName });
    return;
  }
  if (item.sceneItemEnabled === false) {
    await obs.call("SetSceneItemEnabled", { sceneName: NAMES.scene, sceneItemId: item.sceneItemId, sceneItemEnabled: true });
    log(`re-enabled "${inputName}" in the scene`);
  }
}

async function ensureInput(obs: ObsClient, name: string, kind: string, settings: Record<string, unknown>, defaultDb: number, log: Logger, enabled = true): Promise<void> {
  const existing = await findInput(obs, name);
  if (existing && existing.inputKind !== kind) {
    await obs.call("RemoveInput", { inputName: name });
    // OBS releases the source (and its name) asynchronously; creating too early fails with "already exists".
    for (let i = 0; i < 30 && (await findInput(obs, name)); i++) await new Promise((r) => setTimeout(r, 100));
    log(`removed "${name}": wrong kind ${existing.inputKind}`);
  }
  if (existing && existing.inputKind === kind) {
    await obs.call("SetInputSettings", { inputName: name, inputSettings: settings, overlay: true });
    if (enabled) await ensureInScene(obs, name, log);
    return;
  }
  await obs.call("CreateInput", { sceneName: NAMES.scene, inputName: name, inputKind: kind, inputSettings: settings, sceneItemEnabled: enabled });
  await obs.call("SetInputVolume", { inputName: name, inputVolumeDb: defaultDb });
  log(`created "${name}" (${kind}) at ${defaultDb} dB`);
}

async function ensureFilter(obs: ObsClient, sourceName: string, f: { name: string; kind: string; settings: Record<string, unknown> }, log: Logger, warn: Logger): Promise<void> {
  const { filters } = await obs.call("GetSourceFilterList", { sourceName });
  const existing = filters.find((x: any) => x.filterName === f.name);
  try {
    if (existing && existing.filterKind !== f.kind) {
      await obs.call("RemoveSourceFilter", { sourceName, filterName: f.name });
      log(`removed ${f.name} on "${sourceName}": wrong kind`);
    }
    if (existing && existing.filterKind === f.kind) {
      if (f.name !== TRIM_FILTER) await obs.call("SetSourceFilterSettings", { sourceName, filterName: f.name, filterSettings: f.settings, overlay: true });
      if (existing.filterEnabled === false) {
        await obs.call("SetSourceFilterEnabled", { sourceName, filterName: f.name, filterEnabled: true });
        log(`re-enabled ${f.name} on "${sourceName}"`);
      }
      return;
    }
    await obs.call("CreateSourceFilter", { sourceName, filterName: f.name, filterKind: f.kind, filterSettings: f.settings });
    log(`added ${f.name} to "${sourceName}"`);
  } catch (e) {
    warn(`${f.name} on "${sourceName}" unavailable: ${(e as Error).message}`);
  }
}

async function ensureFilterOrder(obs: ObsClient, sourceName: string, order: readonly string[], log: Logger): Promise<void> {
  const { filters } = await obs.call("GetSourceFilterList", { sourceName });
  const current = filters.map((f: any) => f.filterName).filter((n: string) => order.includes(n));
  if (current.join("|") === order.filter((n) => current.includes(n)).join("|")) return;
  for (const [i, name] of order.entries()) {
    if (!current.includes(name)) continue;
    await obs.call("SetSourceFilterIndex", { sourceName, filterName: name, filterIndex: i }).catch(() => {});
  }
  log(`filter order on "${sourceName}": ${order.join(" → ")}`);
}

async function muteStrays(obs: ObsClient, log: Logger): Promise<void> {
  const { inputs } = await obs.call("GetInputList");
  const ours = new Set<string>([NAMES.music, NAMES.mic]);
  for (const i of inputs) {
    if (ours.has(i.inputName) || !/^coreaudio_|^sck_audio/.test(i.inputKind)) continue;
    await obs.call("SetInputMute", { inputName: i.inputName, inputMuted: true });
    await obs.call("SetInputAudioMonitorType", { inputName: i.inputName, monitorType: MONITOR_OFF });
    log(`muted stray audio input "${i.inputName}"`);
  }
}

export async function listMics(obs: ObsClient): Promise<PropItem[]> {
  // The music cable uses the same CoreAudio input kind. Query it on first setup instead of creating
  // a default microphone just to enumerate devices. Never query ScreenCaptureKit application properties.
  const { inputs } = await obs.call("GetInputList");
  const input = [NAMES.mic, NAMES.music].map((name) => inputs.find((i: any) => i.inputName === name && i.inputKind === KINDS.micInput)).find(Boolean);
  if (!input) return [];
  const r = await obs.call("GetInputPropertiesListPropertyItems", { inputName: input.inputName, propertyName: "device_id" });
  return r.propertyItems ?? [];
}

async function silenceMic(obs: ObsClient): Promise<void> {
  // Attempt both safeguards even if one RPC fails, but never continue after a failed safeguard.
  const results = await Promise.allSettled([
    obs.call("SetInputMute", { inputName: NAMES.mic, inputMuted: true }),
    obs.call("SetInputAudioMonitorType", { inputName: NAMES.mic, monitorType: MONITOR_OFF }),
  ]);
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failures.length) throw new Error(`Could not confirm microphone safety: ${failures.map((r) => String(r.reason)).join("; ")}`);
}

// NOTE (history): the music source used to be sck_audio_capture (per-app ScreenCaptureKit). Two problems:
// obs-websocket 5.x segfaults when asked to enumerate its "application" list (strlen on NULL for processes
// without a bundle id), and the capture returned silence for Firefox and Safari. Replaced by a CoreAudio
// process tap (bin/spaces-tap) exposed as an input device, which works for every app tested.

/** What OBS currently has wired. Used by the status endpoint to tell "configured" from "operational". */
export async function readLiveState(obs: ObsClient): Promise<{ collection: string; scene: string; music?: Record<string, unknown>; mic?: Record<string, unknown>; monitor: Record<string, string> }> {
  const [coll, scene] = await Promise.all([obs.call("GetSceneCollectionList"), obs.call("GetCurrentProgramScene")]);
  const out: any = { collection: coll.currentSceneCollectionName, scene: scene.sceneName ?? scene.currentProgramSceneName, monitor: {} };
  for (const [key, name] of [["music", NAMES.music], ["mic", NAMES.mic]] as const) {
    try {
      const [s, m] = await Promise.all([obs.call("GetInputSettings", { inputName: name }), obs.call("GetInputAudioMonitorType", { inputName: name })]);
      out[key] = s.inputSettings;
      out.monitor[key] = m.monitorType;
    } catch {
      /* input missing */
    }
  }
  return out;
}

/** Build (or repair) the whole Spaces mix inside OBS. Safe to run repeatedly. */
export async function runSetup(obs: ObsClient, opts: SetupOptions, log: Logger): Promise<{ warnings: string[] }> {
  const warnings: string[] = [];
  const warn = (s: string) => warnings.push(s);
  await ensureCollection(obs, log);
  if (await findInput(obs, NAMES.mic)) await silenceMic(obs);
  await ensureScene(obs, log);

  await ensureInput(obs, NAMES.music, KINDS.musicInput, { device_id: MUSIC_DEVICE_UID }, DEFAULT_DB.music, log);
  if (!opts.tapDevicePresent) warn("BlackHole 16ch (the music cable) is missing. Install the BlackHole 16ch driver.");
  if (!opts.browserRunning) warn(`${opts.browserBundleId} is not running, so there is nothing to capture yet. Open it and press play.`);

  const pick = pickMic(await listMics(obs), opts.micDeviceUid, opts.micNameHint);
  if (!pick.item) {
    throw new Error(pick.reason === "explicit-missing"
      ? "The selected microphone is not connected. Setup stopped; reconnect it or select another microphone."
      : "No usable microphone found. Setup stopped; plug one in and run setup again.");
  }
  await ensureInput(obs, NAMES.mic, KINDS.micInput, { device_id: pick.item.itemValue }, DEFAULT_DB.mic, log, false);
  await silenceMic(obs);
  log(`mic device: ${pick.item.itemName}${pick.reason === "explicit" ? "" : ` (auto-picked by ${pick.reason})`}; left muted — unmute Mic when ready`);

  for (const f of FILTERS.mic) await ensureFilter(obs, NAMES.mic, f, log, warn);
  for (const f of FILTERS.music) await ensureFilter(obs, NAMES.music, f, log, warn);
  await ensureFilterOrder(obs, NAMES.music, FILTERS.music.map((f) => f.name), log);
  await ensureFilterOrder(obs, NAMES.mic, FILTERS.mic.map((f) => f.name), log);
  await muteStrays(obs, log);
  for (const name of [NAMES.music, NAMES.mic]) {
    await obs.call("SetInputAudioMonitorType", { inputName: name, monitorType: MONITOR_AND_OUTPUT });
  }
  await ensureInScene(obs, NAMES.mic, log);
  log("setup complete");
  return { warnings };
}
