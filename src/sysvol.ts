import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export type MasterState = { volume: number | null; muted: boolean | null; device: string; uid?: string };
export type AudioDevice = { name: string; uid: string; input: boolean; output: boolean; virtual?: boolean };
const BIN = join(import.meta.dir, "..", "bin", "sysvol");

export const helperAvailable = (): boolean => existsSync(BIN);

/** Parse one JSON line from `sysvol get|watch`; undefined for junk lines. */
export function parseMasterLine(line: string): MasterState | undefined {
  try {
    const d = JSON.parse(line);
    if (typeof d !== "object" || d === null || !("volume" in d)) return undefined;
    return { volume: d.volume ?? null, muted: d.muted ?? null, device: String(d.device ?? ""), ...(typeof d.uid === "string" ? { uid: d.uid } : {}) };
  } catch {
    return undefined;
  }
}

export function parseDevices(text: string): AudioDevice[] {
  try {
    const d = JSON.parse(text);
    if (!Array.isArray(d)) return [];
    return d
      .filter((x) => x && typeof x.uid === "string" && x.uid.length > 0)
      .map((x) => ({ name: String(x.name ?? ""), uid: String(x.uid), input: Boolean(x.input), output: Boolean(x.output), ...(typeof x.virtual === "boolean" ? { virtual: x.virtual } : {}) }));
  } catch {
    return [];
  }
}

export const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

function run(args: string[]): string | undefined {
  if (!helperAvailable()) return undefined;
  const r = spawnSync(BIN, args, { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : undefined;
}

export function getMaster(): MasterState | undefined {
  const out = run(["get"]);
  return out ? parseMasterLine(out) : undefined;
}

export function listAudioDevices(): AudioDevice[] {
  const out = run(["devices"]);
  return out ? parseDevices(out) : [];
}

export const setMasterVolume = (v: number, uid: string): boolean => run(["set", clamp01(v).toFixed(3), uid]) !== undefined;
export const setMasterMute = (on: boolean, uid: string): boolean => run(["mute", on ? "1" : "0", uid]) !== undefined;
export const setOutputDevice = (uid: string): boolean => run(["output", uid]) !== undefined;

/** Stream system volume changes. Returns a stop function; no-op (and calls onUnavailable) when the helper is missing. */
export function watchMaster(onChange: (s: MasterState) => void, onUnavailable?: (why: string) => void): () => void {
  if (!helperAvailable()) {
    onUnavailable?.(`helper missing at ${BIN} — run ./start.sh to compile it`);
    return () => {};
  }
  let stopped = false;
  let failures = 0;
  let child: ReturnType<typeof spawn> | undefined;
  const start = () => {
    if (stopped) return;
    child = spawn(BIN, ["watch"], { stdio: ["ignore", "pipe", "ignore"] });
    let buf = "";
    child.on("error", (e) => onUnavailable?.(`helper failed: ${e.message}`));
    child.stdout!.on("data", (chunk) => {
      buf += String(chunk);
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const l of lines) {
        const s = parseMasterLine(l);
        if (s) {
          failures = 0;
          onChange(s);
        }
      }
    });
    child.on("exit", () => {
      failures++;
      if (failures > 5) return onUnavailable?.("helper keeps exiting; master fader disabled");
      setTimeout(start, 1000 * failures);
    });
  };
  start();
  return () => {
    stopped = true;
    child?.kill();
  };
}
