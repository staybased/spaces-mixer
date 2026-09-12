import { expect, test } from "bun:test";
import { physicalDevices, selectMic, selectOutput } from "../src/audio-devices";
import { Sharing } from "../src/sharing";
import type { ObsClient } from "../src/obs-client";
const devices = [
  { uid: "mic", name: "USB Mic", input: true, output: false },
  { uid: "speakers", name: "Speakers", input: false, output: true },
  { uid: "BlackHole2ch_UID", name: "Cable", input: true, output: true },
  { uid: "aggregate", name: "Custom audio", input: true, output: true, virtual: true },
];
function fixture({ profile = "Spaces Mixer", active = false, kind = "coreaudio_input_capture", fail = "", mismatch = false } = {}) {
  const calls: { t: string; d: any }[] = [];
  const mute: Record<string, boolean> = { Mic: false, "Browser Music": false };
  const monitors: Record<string, string> = {};
  let uid = "old";
  const obs = { connected: true, async call(t: string, d: any = {}) {
    calls.push({ t, d });
    if (t === fail) throw Error("RPC failed");
    if (t === "GetProfileList") return { currentProfileName: profile };
    if (t === "GetSceneCollectionList") return { currentSceneCollectionName: "Spaces Mixer" };
    if (t === "GetCurrentProgramScene") return { sceneName: "Spaces Mix" };
    if (t.endsWith("Status")) return { outputActive: active };
    if (t === "GetInputList") return { inputs: Object.keys(mute).map(inputName => ({ inputName, inputKind: kind })) };
    if (t === "GetInputPropertiesListPropertyItems") return { propertyItems: [{ itemName: "USB Mic", itemValue: "mic", itemEnabled: true }] };
    if (t === "SetInputMute") mute[d.inputName] = d.inputMuted;
    if (t === "GetInputMute") return { inputMuted: mute[d.inputName] };
    if (t === "SetInputAudioMonitorType") monitors[d.inputName] = d.monitorType;
    if (t === "GetInputAudioMonitorType") return { monitorType: monitors[d.inputName] };
    if (t === "SetInputSettings") { expect(mute.Mic).toBe(true); expect(monitors.Mic).toBe("OBS_MONITORING_TYPE_NONE"); uid = d.inputSettings.device_id; }
    if (t === "GetInputSettings") return { inputSettings: { device_id: mismatch ? "other" : uid } };
    return {};
  } } as unknown as ObsClient;
  const sharing = new Sharing(() => obs, { set() { throw Error("capture must not start"); }, clear() {} }, () => {});
  sharing.state = { state: "stopped" };
  return { obs, sharing, calls, mute, monitors };
}
test("only connected physical devices in the requested direction are offered", () => {
  expect(physicalDevices(devices, "input").map(d => d.uid)).toEqual(["mic"]);
  expect(physicalDevices(devices, "output").map(d => d.uid)).toEqual(["speakers"]);
});
test("mic switch verifies silence and changes only Mic device settings", async () => {
  const f = fixture();
  await selectMic(f.obs, "mic", devices, f.sharing);
  expect(f.sharing.state.state).toBe("stopped");
  expect(f.mute.Mic).toBe(true);
  expect(f.monitors.Mic).toBe("OBS_MONITORING_TYPE_NONE");
  expect(f.calls.filter(c => c.t === "SetInputSettings")).toEqual([{ t: "SetInputSettings", d: { inputName: "Mic", inputSettings: { device_id: "mic" }, overlay: true } }]);
  expect(f.calls.some(c => /Filter|Create|Remove/.test(c.t))).toBe(false);
});
for (const [name, options, uid] of [
  ["unrelated OBS", { profile: "Other" }, "mic"],
  ["active OBS output", { active: true }, "mic"],
  ["ScreenCaptureKit source", { kind: "sck_audio_capture" }, "mic"],
  ["missing mic", {}, "missing"],
  ["virtual input", {}, "BlackHole2ch_UID"],
] as const) test(`mic switch rejects ${name} without mutations`, async () => {
  const f = fixture(options);
  await expect(selectMic(f.obs, uid, devices, f.sharing)).rejects.toThrow();
  expect(f.calls.some(c => c.t.startsWith("Set"))).toBe(false);
  if (name === "ScreenCaptureKit source") expect(f.calls.some(c => c.t === "GetInputPropertiesListPropertyItems")).toBe(false);
});
test("mic switch refuses an active sharing session", async () => {
  const f = fixture(); f.sharing.state = { state: "sharing" };
  await expect(selectMic(f.obs, "mic", devices, f.sharing)).rejects.toThrow("Stop sharing");
  expect(f.calls).toEqual([]);
});
test("mic switch aborts if mute cannot be confirmed", async () => {
  const f = fixture({ fail: "SetInputMute" });
  await expect(selectMic(f.obs, "mic", devices, f.sharing)).rejects.toThrow();
  expect(f.calls.some(c => c.t === "SetInputSettings")).toBe(false);
  expect(f.sharing.state.state).toBe("error");
});
test("failed settings update and mismatched readback never unmute", async () => {
  for (const options of [{ fail: "SetInputSettings" }, { mismatch: true }]) {
    const f = fixture(options);
    await expect(selectMic(f.obs, "mic", devices, f.sharing)).rejects.toThrow();
    expect(f.mute.Mic).toBe(true);
    expect(f.monitors.Mic).toBe("OBS_MONITORING_TYPE_NONE");
    expect(f.sharing.state.state).toBe("stopped");
  }
});
test("physical output switch accepts hardware-controlled volume and verifies UID", () => {
  const state = { uid: "speakers", device: "Speakers", volume: null, muted: null };
  const calls: string[] = [];
  expect(selectOutput("speakers", devices, uid => { calls.push(uid); return true; }, () => state)).toEqual(state);
  expect(calls).toEqual(["speakers"]);
  expect(() => selectOutput("speakers", devices, () => false, () => state)).toThrow("could not switch");
  expect(() => selectOutput("speakers", devices, () => true, () => ({ ...state, uid: "other" }))).toThrow("did not confirm");
});
test("output rejects missing, input-only and virtual devices before invoking helper", () => {
  for (const uid of ["missing", "mic", "BlackHole2ch_UID", "aggregate"]) {
    expect(() => selectOutput(uid, devices, () => { throw Error("helper invoked"); }, () => undefined)).toThrow("unavailable");
  }
});
