import { spawnSync } from "node:child_process";

export type RunningApp = { name: string; bundleId: string };

/**
 * Parse `lsappinfo list` output into apps that have a bundle id.
 * Processes without a bundle id are skipped: ScreenCaptureKit can't target them,
 * and obs-websocket crashes when asked to enumerate them.
 */
export function parseLsappinfo(text: string): RunningApp[] {
  const out: RunningApp[] = [];
  let name: string | undefined;
  for (const line of text.split("\n")) {
    const head = line.match(/^\s*\d+\)\s+"(.+?)"\s+ASN/);
    if (head) name = head[1];
    const bid = line.match(/bundleID="([^"]+)"/);
    if (bid && name) {
      out.push({ name, bundleId: bid[1] });
      name = undefined;
    }
  }
  return out;
}

export function listRunningApps(): RunningApp[] {
  const r = spawnSync("lsappinfo", ["list"], { encoding: "utf8" });
  if (r.status !== 0) return [];
  return parseLsappinfo(r.stdout);
}

export const isRunning = (apps: RunningApp[], bundleId: string): boolean => apps.some((a) => a.bundleId === bundleId);
