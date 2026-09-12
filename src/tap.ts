import { isBundleId } from "./request-schema";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** The device OBS captures music from: the tap daemon copies the tapped app's audio into this virtual cable. */
export const MUSIC_DEVICE_UID = "BlackHole16ch_UID";
export const MUSIC_DEVICE_NAME = "BlackHole 16ch";
/** The daemon's own (private) aggregate; only used as a fallback when the cable is missing. */
export const TAP_DEVICE_UID = "SpacesMixerTap_UID";
const BIN = join(import.meta.dir, "..", "bin", "spaces-tap");

export type TapState = { bundle: string | null; processes: number; device: string | null; tapping: boolean; bridged?: boolean; error?: string; note?: string; io?: Record<string, unknown> };

export const tapHelperAvailable = (): boolean => existsSync(BIN);

/** Parse one status line from the daemon. */
export function parseTapLine(line: string): TapState | undefined {
  try {
    const d = JSON.parse(line);
    if (typeof d !== "object" || d === null) return undefined;
    if ("ready" in d) return { bundle: null, processes: 0, device: null, tapping: false };
    if ("error" in d && !("tapping" in d)) return { bundle: null, processes: 0, device: null, tapping: false, error: String(d.error) };
    if (!("tapping" in d)) return undefined; // bare note line
    return { bundle: d.bundle ?? null, processes: Number(d.processes ?? 0), device: d.device ?? null, tapping: Boolean(d.tapping), bridged: Boolean(d.bridged), note: d.note, io: d.io };
  } catch {
    return undefined;
  }
}

/**
 * Long-lived handle on the tap daemon. `set(bundleId)` retargets the tap; the daemon follows the app's
 * processes as they come and go. Restarts the daemon if it dies, re-applying the last target.
 */
export class TapDaemon {
  state: TapState = { bundle: null, processes: 0, device: null, tapping: false };
  private child?: ReturnType<typeof spawn>;
  private wanted: string | null = null;
  private stopped = false;
  private failures = 0;

  constructor(private readonly onChange: (s: TapState) => void) {
    this.start();
  }

  get available(): boolean {
    return tapHelperAvailable();
  }

  private start(): void {
    if (this.stopped || !tapHelperAvailable()) return;
    const child = spawn(BIN, ["serve"], { stdio: ["pipe", "pipe", "ignore"] });
    this.child = child;
    let buf = "";
    child.stdout!.on("data", (chunk) => {
      if (this.child !== child) return;
      buf += String(chunk);
      if (buf.length > 65536) { child.kill(); return; }
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const l of lines) {
        const s = parseTapLine(l);
        if (!s) continue;
        if (s.error) {
          this.state = { ...this.state, error: s.error };
        } else {
          this.state = { ...s, error: undefined };
          if (s.tapping && s.bridged) this.failures = 0;
        }
        this.onChange(this.state);
      }
    });
    child.on("error", (e) => {
      this.state = { ...this.state, tapping: false, error: `tap helper failed: ${e.message}` };
      this.onChange(this.state);
    });
    child.on("exit", () => {
      if (this.child !== child) return;
      this.child = undefined;
      this.state = { ...this.state, tapping: false, device: null };
      this.onChange(this.state);
      this.failures++;
      if (this.failures <= 5 && !this.stopped) setTimeout(() => this.start(), 1000 * this.failures);
    });
    child.stdin?.on("error", () => { this.state = { ...this.state, error: "Capture control pipe failed" }; this.onChange(this.state); });
    if (this.wanted) this.send(`tap ${this.wanted}`);
  }

  private send(cmd: string): void {
    this.child?.stdin?.write(cmd + "\n");
  }

  set(bundleId: string): void {
    if (!isBundleId(bundleId)) throw new Error("Invalid capture app identifier");
    this.wanted = bundleId;
    this.send(`tap ${bundleId}`);
  }

  clear(): void {
    this.wanted = null;
    this.send("untap");
  }

  stop(): void {
    this.stopped = true;
    this.child?.kill();
  }
}
