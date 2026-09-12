import { spawnSync } from "node:child_process";
import { OBS_PROFILE } from "./obs-config";

function obsPids(): number[] {
  const r = spawnSync("pgrep", ["-x", "-u", String(process.getuid!()), "OBS"], { encoding: "utf8" });
  if (r.status === 1) return [];
  if (r.status !== 0 || !/^\d+(\s+\d+)*$/.test(r.stdout.trim())) throw new Error("Could not verify OBS process state");
  return r.stdout.trim().split(/\s+/).map(Number);
}
export function isObsRunning(): boolean { return obsPids().length > 0; }

export function launchObs(): void {
  // Select only the dedicated mixer profile; retain OBS crash/safe-mode prompts.
  const r = spawnSync("open", ["-a", "OBS", "--args", "--profile", OBS_PROFILE, "--collection", OBS_PROFILE], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`Could not launch OBS: ${r.stderr.trim()}`);
}

export function signalObsQuit(pids: number[], signal: (pid: number, name: "SIGTERM") => unknown = process.kill): void {
  if (!pids.length) return;
  if (pids.length !== 1 || !Number.isSafeInteger(pids[0]) || pids[0] <= 1) throw new Error("Expected exactly one owned OBS process; quit OBS manually");
  // OBS handles SIGTERM on its main event loop for orderly shutdown. This
  // avoids the observed Qt/Cocoa crash in the AppleEvent quit path (32.1.2).
  // https://github.com/obsproject/obs-studio/blob/32.1.2/frontend/OBSApp.cpp
  signal(pids[0], "SIGTERM");
}
async function requestQuit(): Promise<string | undefined> {
  try { signalObsQuit(obsPids()); return undefined; }
  catch (error) { return (error as Error).message; }
}

export async function quitObs(options: { request?: () => Promise<string | undefined>; running?: () => boolean; timeoutMs?: number } = {}): Promise<void> {
  const running = options.running ?? isObsRunning;
  if (!running()) return;
  const error = await (options.request ?? requestQuit)();
  // AppleScript can report -128 after OBS has exited. Process state, never
  // the dialog result alone, decides whether config files can be patched.
  if (await waitFor(() => !running(), options.timeoutMs ?? 15000)) return;
  throw new Error("OBS is still running. " + (error || "Quit it manually and try again."));
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function waitFor(pred: () => boolean, timeoutMs: number, stepMs = 250): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await sleep(stepMs);
  }
  return pred();
}
