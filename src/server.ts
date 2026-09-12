import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ServerWebSocket } from "bun";
import { mulToDb } from "./audio-math";
import { KNOWN_BROWSERS, captureCandidates, runningBrowserCount } from "./capture-sources";
import { createRouter, MAX_BODY_BYTES } from "./http-router";
import { assertIdle, assertOwned } from "./obs-safety";
import { Sharing } from "./sharing";
import { isBundleId } from "./request-schema";
import { ObsClient } from "./obs-client";
import { writeAtomic, MONITOR_DEVICE, applyConfigPatches, readConfigStatus, readWsConfig } from "./obs-config";
import { isObsRunning, launchObs, quitObs, waitFor } from "./obs-process";
import { isRunning, listRunningApps } from "./running-apps";
import { NAMES, TRIM_FILTER, listMics, readLiveState, runSetup } from "./setup";
import { nextTrim } from "./trim";
import { MUSIC_DEVICE_UID, TapDaemon } from "./tap";
import { getMaster, helperAvailable, listAudioDevices, setMasterMute, setMasterVolume, watchMaster, type MasterState } from "./sysvol";

const PORT = Number(process.env.PORT ?? 4780);
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) throw new Error("PORT must be 1024..65535");
const PUBLIC = join(import.meta.dir, "..", "public");
const INPUTS = { music: NAMES.music, mic: NAMES.mic } as const;
type InputKey = keyof typeof INPUTS;
const RECONNECT_MS = 2000;
const STRAY_METER_MS = 1500;


// ---- dashboard clients ------------------------------------------------------

const clients = new Set<ServerWebSocket<unknown>>();
const broadcast = (msg: unknown): void => {
  const s = JSON.stringify(msg, (_k, v) => (v === -Infinity ? null : v));
  for (const c of clients) { try { if (c.send(s) === -1) c.close(1013, "Slow client"); } catch { clients.delete(c); } }
};

// ---- system master volume ----------------------------------------------------

let master: MasterState | undefined = getMaster();
let masterError: string | undefined = helperAvailable() ? undefined : "helper missing — run ./start.sh";
const stopMasterWatch = watchMaster(
  (s) => {
    master = s;
    masterError = undefined;
    broadcast({ type: "master", ...s });
  },
  (why) => {
    masterError = why;
    master = undefined;
    broadcast({ type: "master", volume: null, muted: null, device: "", error: why });
  },
);

// ---- per-app music tap ----------------------------------------------------------

import { readFileSync as readFs } from "node:fs";
import { homedir } from "node:os";
const STATE_DIR = join(homedir(), "Library", "Application Support", "spaces-mixer");
const STATE_FILE = join(STATE_DIR, "state.json");
type Persisted = { musicApp?: string; autoTrim?: boolean; trimDb?: number };
const loadState = (): Persisted => {
  try {
    const p = JSON.parse(readFs(STATE_FILE, "utf8"));
    return { musicApp: isBundleId(p?.musicApp) ? p.musicApp : undefined, autoTrim: typeof p?.autoTrim === "boolean" ? p.autoTrim : true, trimDb: typeof p?.trimDb === "number" && Number.isFinite(p.trimDb) && p.trimDb >= -20 && p.trimDb <= 30 ? p.trimDb : 0 };
  } catch { return {}; }
};
const saveState = (p: Persisted): void => { try { writeAtomic(STATE_FILE, JSON.stringify(p)); } catch { console.error("Could not save mixer preferences"); } };
const persisted = loadState();
let musicApp: string | undefined = persisted.musicApp ?? KNOWN_BROWSERS[0].bundleId;
let autoTrim = persisted.autoTrim ?? true;
let trimDb = persisted.trimDb ?? 0;
let trimApplied: number | undefined;
const tap = new TapDaemon((s) => broadcast({ type: "tap", ...s }));
const sharing = new Sharing(() => obs, tap, (session) => broadcast({ type: "session", ...session }));

// ---- auto-trim: keep the music's pre-fader peak near TRIM_TARGET_DB ----------------

async function applyTrim(db: number): Promise<void> {
  if (!obs?.connected || !sharing.active || trimApplied === db) return;
  try {
    await assertOwned(obs, true);
    await obs.call("SetSourceFilterSettings", { sourceName: NAMES.music, filterName: TRIM_FILTER, filterSettings: { db }, overlay: true });
    trimApplied = db;
    broadcast({ type: "trim", db, auto: autoTrim });
  } catch {
    /* filter not built yet */
  }
}
setInterval(() => {
  const inPeak = Number((tap.state.io as any)?.inPeakDb ?? -120);
  if (autoTrim && sharing.active) {
    const next = nextTrim(trimDb, inPeak);
    if (next !== trimDb) {
      trimDb = next;
      saveState({ musicApp, autoTrim, trimDb });
    }
  }
  void applyTrim(trimDb);
}, 3000);

// ---- OBS connection: single in-flight attempt, identity-guarded close --------

let obs: ObsClient | undefined;
let connecting = false;
let obsError: string | undefined;
let lastMeterAt = 0;

async function connectObs(): Promise<void> {
  if (connecting || obs?.connected) return;
  if (!isObsRunning()) {
    obsError = undefined;
    return;
  }
  let cfg;
  try {
    cfg = readWsConfig();
  } catch (e) {
    obsError = (e as Error).message;
    return;
  }
  if (!cfg.server_enabled || !cfg.auth_required || !cfg.server_password) {
    obsError = "OBS WebSocket must be enabled and authenticated — click Prepare OBS";
    return;
  }
  connecting = true;
  const client = new ObsClient(`ws://127.0.0.1:${cfg.server_port}`, cfg.server_password);
  client.onEvent(handleObsEvent);
  client.onClose = (c) => {
    if (obs !== c) return; // a stale loser must not clobber the live connection
    sharing.disconnected();
    obs = undefined;
    obsError = c.lastError;
    broadcast({ type: "obs", connected: false, error: obsError });
    broadcast({ type: "state", inputs: offlineInputs() });
  };
  try {
    await client.connect();
    obs = client;
    obsError = undefined;
    await sharing.stop().catch(() => {}); // state exposes failure; unrelated profiles are never mutated
    broadcast({ type: "obs", connected: true });
    broadcast({ type: "state", inputs: await readInputs() });
  } catch (e) {
    obsError = (e as Error).message;
    client.close();
  } finally {
    connecting = false;
  }
}
setInterval(connectObs, RECONNECT_MS);
void connectObs();

function handleObsEvent(e: { eventType: string; eventData: any }): void {
  if (e.eventType === "InputVolumeMeters") {
    const levels: Record<string, number[]> = {};
    if (!Array.isArray(e.eventData?.inputs)) return;
    for (const i of e.eventData.inputs) {
      if (!i || !Array.isArray(i.inputLevelsMul)) continue;
      const key = (Object.keys(INPUTS) as InputKey[]).find((k) => INPUTS[k] === i.inputName);
      if (!key) continue;
      levels[key] = (i.inputLevelsMul ?? []).map((ch: number[]) => mulToDb(Array.isArray(ch) && typeof ch[1] === "number" && Number.isFinite(ch[1]) ? ch[1] : 0));
    }
    if (Object.keys(levels).length) {
      lastMeterAt = Date.now();
      broadcast({ type: "meters", levels });
    }
    return;
  }
  if (e.eventType === "InputVolumeChanged" || e.eventType === "InputMuteStateChanged" || e.eventType === "InputRemoved" || e.eventType === "InputCreated") {
    void readInputs().then((inputs) => broadcast({ type: "state", inputs }));
  }
}
// Meters stop when OBS dies or the sources vanish; tell the panel so bars don't freeze mid-level.
setInterval(() => {
  if (lastMeterAt && Date.now() - lastMeterAt > STRAY_METER_MS) {
    lastMeterAt = 0;
    broadcast({ type: "meters", levels: { music: [-60, -60], mic: [-60, -60] } });
  }
}, 500);

type InputState = { volumeDb: number | null; muted: boolean; exists: boolean };
const offlineInputs = (): Record<InputKey, InputState> => ({ music: { volumeDb: null, muted: false, exists: false }, mic: { volumeDb: null, muted: false, exists: false } });

async function readInputs(): Promise<Record<InputKey, InputState>> {
  const out = offlineInputs();
  if (!obs?.connected) return out;
  for (const key of Object.keys(INPUTS) as InputKey[]) {
    const inputName = INPUTS[key];
    try {
      const [{ inputVolumeDb, inputVolumeMul }, { inputMuted }] = await Promise.all([
        obs.call("GetInputVolume", { inputName }),
        obs.call("GetInputMute", { inputName }),
      ]);
      out[key] = { volumeDb: inputVolumeMul === 0 ? null : inputVolumeDb, muted: inputMuted, exists: true };
    } catch {
      /* input missing: stays offline */
    }
  }
  return out;
}

// ---- API ------------------------------------------------------------------------

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data, (_k, v) => (v === -Infinity ? null : v)), { status, headers: { "content-type": "application/json" } });

const browsers = () => captureCandidates(listRunningApps());

async function status(): Promise<Response> {
  let config: ReturnType<typeof readConfigStatus> | { error: string };
  try {
    config = readConfigStatus();
  } catch (e) {
    config = { error: (e as Error).message };
  }
  const devices = listAudioDevices();
  const blackholePresent = devices.some((d) => d.uid === MONITOR_DEVICE.id);
  const connected = Boolean(obs?.connected);
  const live = connected ? await readLiveState(obs!).catch(() => undefined) : undefined;
  const micUid = live?.mic?.device_id as string | undefined;
  const micPresent = micUid ? devices.some((d) => d.uid === micUid && d.input) : undefined;
  const sources = browsers();
  return json({
    session: sharing.state,
    obsRunning: isObsRunning(),
    obsConnected: connected,
    obsError,
    config,
    monitorDevice: MONITOR_DEVICE,
    /** OUT is green only when config AND device agree. */
    outOk: Boolean(!("error" in config) && config.monitoringConfigured && blackholePresent),
    blackholePresent,
    live: live && {
      collection: live.collection,
      scene: live.scene,
      onOurScene: live.collection === NAMES.collection && live.scene === NAMES.scene,
      monitor: live.monitor,
      musicApp,
      musicAppRunning: musicApp ? isRunning(listRunningApps(), musicApp) : undefined,
      musicDeviceOk: live.music?.device_id === MUSIC_DEVICE_UID,
      micUid,
      micPresent,
    },
    tap: { ...tap.state, helper: tap.available, devicePresent: devices.some((d) => d.uid === MUSIC_DEVICE_UID) },
    trim: { db: trimDb, auto: autoTrim, applied: trimApplied === trimDb },
    /** True when only one browser runs: the Space and the music would share an echo canceller. */
    singleBrowserRisk: runningBrowserCount(sources) <= 1,
    inputs: await readInputs(),
    master: master ?? null,
    masterError,
    browsers: sources,
  });
}

let busy: string | undefined;
async function exclusive<T>(name: string, fn: () => Promise<T>): Promise<T | Response> {
  if (busy) return json({ error: `${busy} is still running` }, 409);
  busy = name;
  try {
    return await fn();
  } finally {
    busy = undefined;
  }
}

async function prepare(body: { force?: boolean }): Promise<Response> {
  return exclusive("prepare", async () => {
    const running = isObsRunning();
    if (sharing.active) return json({ error: "Stop sharing before preparing OBS" }, 409);
    if (running) {
      if (!obs?.connected) return json({ error: "Cannot verify OBS state. Close OBS manually before Prepare." }, 409);
      await assertOwned(obs);
      await assertIdle(obs);
    }
    if (running && !body.force) return json({ needsQuit: true }, 409);
    if (running) {
      await sharing.stop();
      await assertIdle(obs!);
      await quitObs();
      if (!(await waitFor(() => !isObsRunning(), 15000))) return json({ error: "OBS did not quit. Quit it manually and try again." }, 500);
    }
    if (isObsRunning()) throw new Error("OBS is still running; configuration was not modified");
    const { changed } = applyConfigPatches();
    launchObs();
    const up = await waitFor(() => isObsRunning(), 15000);
    return json({ changed, launched: up });
  }) as Promise<Response>;
}

async function setup(body: { browserBundleId?: string; micDeviceUid?: string }): Promise<Response> {
  return exclusive("setup", async () => {
    if (!obs?.connected) return json({ error: "OBS is not connected" }, 503);
    if (sharing.active) return json({ error: "Stop sharing before rebuilding the mix" }, 409);
    await assertOwned(obs);
    await assertIdle(obs);
    await sharing.stop();
    const browserBundleId = body.browserBundleId ?? musicApp ?? KNOWN_BROWSERS[0].bundleId;
    const log: string[] = [];
    try {
      if (!tap.available) log.push("warning: bin/spaces-tap missing — run ./start.sh to compile it");
      musicApp = browserBundleId;
      saveState({ musicApp, autoTrim, trimDb });
      // Setup never starts capture.
      trimApplied = undefined;
      await new Promise((r) => setTimeout(r, 400));
      const browserRunning = isRunning(listRunningApps(), browserBundleId);
      const tapDevicePresent = listAudioDevices().some((d) => d.uid === MUSIC_DEVICE_UID);
      const { warnings } = await runSetup(obs, { browserBundleId, browserRunning, tapDevicePresent, micDeviceUid: body.micDeviceUid }, (l) => log.push(l));
      await sharing.stop();
      if (runningBrowserCount(browsers()) <= 1) warnings.push("Only one browser is running. The Space must be in a different browser than the music, or its echo canceller will remove the music.");
      broadcast({ type: "state", inputs: await readInputs() });
      return json({ log, warnings });
    } catch (e) {
      return json({ error: (e as Error).message, log }, 500);
    }
  }) as Promise<Response>;
}

/** Repoint the music tap at another app. OBS keeps reading the same tap device; nothing to rebuild. */
async function setSource(body: { bundleId?: string }): Promise<Response> {
  const bundleId = String(body.bundleId ?? "");
  if (!/^[A-Za-z0-9.\-_]+$/.test(bundleId)) return json({ error: "bundleId required" }, 400);
  if (!tap.available) return json({ error: "tap helper missing — run ./start.sh" }, 503);
  musicApp = bundleId;
  saveState({ musicApp, autoTrim, trimDb });
  if (sharing.active) { await assertOwned(obs!, true); tap.set(bundleId); }
  const running = isRunning(listRunningApps(), bundleId);
  broadcast({ type: "source", bundleId, running });
  return json({ ok: true, bundleId, running });
}

async function setTrim(body: { auto?: boolean; db?: number }): Promise<Response> {
  if (typeof body.auto === "boolean") autoTrim = body.auto;
  if (typeof body.db === "number" && Number.isFinite(body.db)) trimDb = Math.max(-20, Math.min(30, Math.round(body.db * 2) / 2));
  saveState({ musicApp, autoTrim, trimDb });
  await applyTrim(trimDb);
  return json({ ok: true, trim: { db: trimDb, auto: autoTrim } });
}

async function devices(): Promise<Response> {
  const system = listAudioDevices().filter((d) => d.input && !/BlackHole|SpacesMixerTap/i.test(d.uid));
  let mics = system.map((d) => ({ itemName: d.name, itemValue: d.uid, itemEnabled: true }));
  let currentMic: string | null = null;
  if (obs?.connected) {
    const fromObs = await listMics(obs).catch(() => []);
    if (fromObs.length) mics = fromObs.filter((m) => m.itemValue !== "default" && !/BlackHole|SpacesMixerTap/i.test(m.itemValue));
    currentMic = await obs.call("GetInputSettings", { inputName: NAMES.mic }).then((r) => r.inputSettings?.device_id ?? null).catch(() => null);
  }
  return json({ mics, apps: browsers(), currentMic });
}

const dbOrSilence = (db: unknown): { inputVolumeDb: number } | { inputVolumeMul: number } | undefined => {
  if (db === null || db === undefined) return { inputVolumeMul: 0 };
  const n = Number(db);
  return Number.isFinite(n) ? { inputVolumeDb: Math.max(-100, Math.min(26, n)) } : undefined;
};

async function setVolume(body: { input?: string; db?: number | null }): Promise<Response> {
  if (!obs?.connected) return json({ error: "OBS is not connected" }, 503);
  await assertOwned(obs, true);
  const inputName = INPUTS[body.input as InputKey];
  if (!inputName) return json({ error: "unknown input" }, 400);
  const vol = dbOrSilence(body.db);
  if (!vol) return json({ error: "db must be a number or null" }, 400);
  await obs.call("SetInputVolume", { inputName, ...vol });
  return json({ ok: true });
}

async function setMute(body: { input?: string; muted?: boolean }): Promise<Response> {
  if (!obs?.connected) return json({ error: "OBS is not connected" }, 503);
  await assertOwned(obs, true);
  const inputName = INPUTS[body.input as InputKey];
  if (!inputName) return json({ error: "unknown input" }, 400);
  if (body.muted === false && !sharing.active) return json({ error: "Start sharing before unmuting a source" }, 409);
  await obs.call("SetInputMute", { inputName, inputMuted: body.muted });
  const { inputMuted } = await obs.call("GetInputMute", { inputName });
  return json({ ok: true, muted: inputMuted });
}

async function setMaster(body: { volume?: number; muted?: boolean }): Promise<Response> {
  if (!helperAvailable()) return json({ error: masterError ?? "master volume helper unavailable" }, 503);
  if (typeof body.volume === "number") {
    if (!Number.isFinite(body.volume)) return json({ error: "volume must be 0..1" }, 400);
    if (!setMasterVolume(body.volume)) return json({ error: "could not set system volume" }, 500);
  }
  if (typeof body.muted === "boolean" && !setMasterMute(body.muted)) return json({ error: "could not set system mute" }, 500);
  master = getMaster() ?? master;
  return json({ ok: true, master });
}

async function sessionAction(body: { action: "start" | "stop" | "quit" }): Promise<Response> {
  console.info("Sharing action:", body.action);
  return exclusive("sharing", async () => {
    if (body.action === "start") {
      if (!tap.available || !musicApp) return json({ error: "Music capture helper or app unavailable" }, 503);
      const live = await readLiveState(obs!);
      const devices = listAudioDevices();
      if (!devices.some((d) => d.uid === live.mic?.device_id && d.input) || live.music?.device_id !== MUSIC_DEVICE_UID) throw new Error("Verify the selected mic and music cable in Setup");
      await sharing.start(musicApp);
    } else {
      await sharing.stop();
      if (body.action === "quit") setTimeout(() => { tap.stop(); stopMasterWatch(); obs?.close(); server.stop(true); process.exit(0); }, 150);
    }
    return json({ ok: true, session: sharing.state });
  }) as Promise<Response>;
}

const STATIC: Record<string, string> = { "/": "index.html", "/app.js": "app.js", "/style.css": "style.css" };
const MIME: Record<string, string> = { html: "text/html; charset=utf-8", js: "text/javascript", css: "text/css" };

const control = (fn: (body: any) => Promise<Response>) => (body: any) => exclusive("control", () => fn(body)) as Promise<Response>;
const route = createRouter(PORT,
  { ...Object.fromEntries(Object.entries(STATIC).map(([path, file]) => [path, () => new Response(readFileSync(join(PUBLIC, file)), { headers: { "content-type": MIME[file.split(".").pop()!] } })])), "/api/status": status, "/api/devices": devices },
  { "/api/obs/prepare": prepare, "/api/setup": setup, "/api/volume": control(setVolume), "/api/mute": control(setMute), "/api/master": control(setMaster), "/api/source": control(setSource), "/api/trim": control(setTrim), "/api/session": sessionAction },
  (req, srv) => clients.size < 8 && srv.upgrade(req),
);

const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  maxRequestBodySize: MAX_BODY_BYTES,
  idleTimeout: 10,
  fetch: route,
  websocket: {
    maxPayloadLength: 1024, backpressureLimit: 65536, closeOnBackpressureLimit: true, idleTimeout: 15,
    open(ws) {
      if (clients.size >= 8) { ws.close(1013, "Too many clients"); return; }
      clients.add(ws);
      ws.send(JSON.stringify({ type: "obs", connected: Boolean(obs?.connected), error: obsError }));
      if (master) ws.send(JSON.stringify({ type: "master", ...master }));
      else if (masterError) ws.send(JSON.stringify({ type: "master", volume: null, muted: null, device: "", error: masterError }));
      void readInputs().then((inputs) => ws.send(JSON.stringify({ type: "state", inputs })));
    },
    close(ws) {
      clients.delete(ws);
      if (!clients.size && sharing.active) void sharing.stop().catch((e) => console.error("Stop on disconnect failed:", e.message));
    },
    message(ws) { ws.close(1008, "Dashboard socket is receive-only"); },
  },
});

let shuttingDown = false;
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, () => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info("Controller shutdown signal:", sig);
  void sharing.stop().catch((e) => console.error("STOP UNCONFIRMED:", e.message)).finally(() => { tap.stop(); stopMasterWatch(); obs?.close(); server.stop(true); process.exit(sharing.state.state === "stopped" ? 0 : 1); });
});
console.log(`Spaces Mixer  →  http://127.0.0.1:${server.port}`);
