import { expect, test } from "bun:test";
import { quitObs, signalObsQuit } from "../src/obs-process";

test("graceful quit refuses ambiguous processes and process-group targets", () => {
  const calls: unknown[] = [];
  const signal = (...args: unknown[]) => calls.push(args);
  for (const pids of [[0], [-1], [1], [NaN], [123, 456]]) expect(() => signalObsQuit(pids, signal)).toThrow();
  expect(calls).toEqual([]);
  signalObsQuit([123], signal);
  expect(calls).toEqual([[123, "SIGTERM"]]);
});

test("quit accepts a cancelled AppleScript result only after OBS actually exits", async () => {
  let running = true;
  await quitObs({ running: () => running, request: async () => { running = false; return "User canceled (-128)"; }, timeoutMs: 0 });
  expect(running).toBe(false);
});

test("quit refuses a cancelled request while OBS remains running", async () => {
  await expect(quitObs({ running: () => true, request: async () => "User canceled (-128)", timeoutMs: 0 })).rejects.toThrow("OBS is still running. User canceled (-128)");
});

test("successful AppleScript does not authorize patching a still-running OBS", async () => {
  await expect(quitObs({ running: () => true, request: async () => undefined, timeoutMs: 0 })).rejects.toThrow("OBS is still running");
});

test("already closed OBS needs no quit request", async () => {
  let calls = 0;
  await quitObs({ running: () => false, request: async () => { calls++; return undefined; }, timeoutMs: 0 });
  expect(calls).toBe(0);
});
