import { describe, expect, test } from "bun:test";
import { FILTERS, KINDS, NAMES, isLoopbackDevice, listMics, pickMic, runSetup } from "../src/setup";
import type { ObsClient } from "../src/obs-client";
import { isRunning, parseLsappinfo } from "../src/running-apps";

const mics = [
  { itemName: "Default", itemValue: "default", itemEnabled: true },
  { itemName: "BlackHole 2ch", itemValue: "BlackHole2ch_UID", itemEnabled: true },
  { itemName: "HD Pro Webcam C920", itemValue: "webcam-uid", itemEnabled: true },
  { itemName: "USB Condenser Microphone", itemValue: "condenser-uid", itemEnabled: true },
  { itemName: "Broken Device", itemValue: "broken-uid", itemEnabled: false },
];

function setupObs({ existingMic = true, devices = mics, fail = "", micKind = KINDS.micInput as string } = {}) {
  const calls: { type: string; data: any }[] = [];
  let inputs = [
    { inputName: NAMES.music as string, inputKind: KINDS.musicInput as string },
    ...(existingMic ? [{ inputName: NAMES.mic, inputKind: micKind }] : []),
  ];
  let items = inputs.map((i, sceneItemId) => ({ sourceName: i.inputName, sceneItemId, sceneItemEnabled: true }));
  const obs = {
    async call(type: string, data: any = {}) {
      calls.push({ type, data });
      if (type === fail) throw new Error(`failed ${type}`);
      switch (type) {
        case "GetSceneCollectionList": return { currentSceneCollectionName: NAMES.collection };
        case "GetSceneList": return { scenes: [{ sceneName: NAMES.scene }] };
        case "GetInputList": return { inputs };
        case "GetSceneItemList": return { sceneItems: items };
        case "GetInputPropertiesListPropertyItems": return { propertyItems: devices };
        case "GetSourceFilterList": return { filters: (data.sourceName === NAMES.mic ? FILTERS.mic : FILTERS.music).map((f) => ({ filterName: f.name, filterKind: f.kind, filterEnabled: true })) };
        case "CreateInput":
          inputs = [...inputs, { inputName: data.inputName, inputKind: data.inputKind }];
          items = [...items, { sourceName: data.inputName, sceneItemId: items.length, sceneItemEnabled: data.sceneItemEnabled }];
          return {};
        case "RemoveInput":
          inputs = inputs.filter((i) => i.inputName !== data.inputName);
          items = items.filter((i) => i.sourceName !== data.inputName);
          return {};
        case "SetCurrentProgramScene": case "SetInputSettings": case "SetInputMute":
        case "SetInputAudioMonitorType": case "SetInputVolume": case "SetSourceFilterSettings":
        case "SetSceneItemEnabled": return {};
        default: throw new Error(`Unexpected RPC: ${type}`);
      }
    },
  };
  return { obs: obs as unknown as ObsClient, calls };
}

const setupOptions = { browserBundleId: "org.mozilla.firefox", browserRunning: true, tapDevicePresent: true, micDeviceUid: "condenser-uid" };
const noLog = () => {};

describe("runSetup microphone safety", () => {
  for (const existingMic of [true, false]) {
    test(`missing explicit mic rejects without fallback (existing=${existingMic})`, async () => {
      const { obs, calls } = setupObs({ existingMic });
      await expect(runSetup(obs, { ...setupOptions, micDeviceUid: "unplugged" }, noLog)).rejects.toThrow("selected microphone is not connected");
      expect(calls.filter((c) => c.type === "CreateInput" && c.data.inputName === NAMES.mic)).toEqual([]);
      expect(calls.filter((c) => c.type === "SetInputSettings" && c.data.inputName === NAMES.mic)).toEqual([]);
      expect(calls.filter((c) => c.type === "SetInputAudioMonitorType" && c.data.monitorType !== "OBS_MONITORING_TYPE_NONE")).toEqual([]);
      if (existingMic) {
        expect(calls).toContainEqual({ type: "SetInputMute", data: { inputName: NAMES.mic, inputMuted: true } });
        expect(calls).toContainEqual({ type: "SetInputAudioMonitorType", data: { inputName: NAMES.mic, monitorType: "OBS_MONITORING_TYPE_NONE" } });
      }
    });
    test(`valid selected mic stays muted after setup (existing=${existingMic})`, async () => {
      const { obs, calls } = setupObs({ existingMic });
      await runSetup(obs, setupOptions, noLog);
      const select = calls.findIndex((c) => ["SetInputSettings", "CreateInput"].includes(c.type) && c.data.inputName === NAMES.mic);
      expect(calls[select].data.inputSettings).toEqual({ device_id: "condenser-uid" });
      const enumerate = calls.findIndex((c) => c.type === "GetInputPropertiesListPropertyItems");
      expect(enumerate).toBeLessThan(select);
      const mute = calls.findIndex((c) => c.type === "SetInputMute" && c.data.inputName === NAMES.mic);
      const monitor = calls.findIndex((c) => c.type === "SetInputAudioMonitorType" && c.data.inputName === NAMES.mic && c.data.monitorType === "OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT");
      expect(monitor).toBeGreaterThan(mute);
      expect(calls.filter((c) => c.type === "SetInputMute" && c.data.inputMuted === false)).toEqual([]);
      if (existingMic) expect(mute).toBeLessThan(select);
      else {
        expect(calls[select].data.sceneItemEnabled).toBe(false);
        expect(calls.findIndex((c) => c.type === "SetSceneItemEnabled" && c.data.sceneItemEnabled)).toBeGreaterThan(mute);
      }
    });
  }
  test("no usable mic rejects without creating a default source", async () => {
    const { obs, calls } = setupObs({ existingMic: false, devices: [] });
    await expect(runSetup(obs, { ...setupOptions, micDeviceUid: undefined }, noLog)).rejects.toThrow("No usable microphone");
    expect(calls.some((c) => c.type === "CreateInput" && c.data.inputName === NAMES.mic)).toBe(false);
  });
  for (const fail of ["SetInputMute", "SetInputAudioMonitorType", "GetInputPropertiesListPropertyItems", "SetInputSettings"]) {
    test(`RPC failure stops setup: ${fail}`, async () => {
      const { obs, calls } = setupObs({ fail });
      await expect(runSetup(obs, setupOptions, noLog)).rejects.toThrow(fail);
      expect(calls.some((c) => c.type === "SetInputAudioMonitorType" && c.data.monitorType === "OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT")).toBe(false);
      expect(calls).toContainEqual({ type: "SetInputAudioMonitorType", data: { inputName: NAMES.mic, monitorType: "OBS_MONITORING_TYPE_NONE" } });
      expect(calls).toContainEqual({ type: "SetInputMute", data: { inputName: NAMES.mic, inputMuted: true } });
    });
  }
  test("enumerates only a known CoreAudio source, even when Mic has the wrong kind", async () => {
    const { obs, calls } = setupObs({ micKind: "sck_audio_capture" });
    await listMics(obs);
    expect(calls.filter((c) => c.type === "GetInputPropertiesListPropertyItems")).toEqual([
      { type: "GetInputPropertiesListPropertyItems", data: { inputName: NAMES.music, propertyName: "device_id" } },
    ]);
  });
});

describe("pickMic", () => {
  test("exact uid wins", () => expect(pickMic(mics, "webcam-uid")).toEqual({ item: mics[2], reason: "explicit" }));
  test("explicit uid that is unplugged does NOT fall back to another mic", () => {
    expect(pickMic(mics, "missing-uid")).toEqual({ reason: "explicit-missing" });
  });
  test("no uid: name hint", () => expect(pickMic(mics)).toMatchObject({ reason: "hint", item: { itemValue: "condenser-uid" } }));
  test("no uid, no hint match: first enabled non-loopback", () => {
    expect(pickMic(mics, undefined, "zzz")).toMatchObject({ reason: "first", item: { itemValue: "webcam-uid" } });
  });
  test("never picks BlackHole, default, or disabled", () => {
    const onlyBad = [mics[0], mics[1], mics[4]];
    expect(pickMic(onlyBad)).toEqual({ reason: "none" });
    expect(pickMic(onlyBad, "BlackHole2ch_UID")).toEqual({ reason: "explicit-missing" });
  });
  test("isLoopbackDevice", () => {
    expect(isLoopbackDevice(mics[1])).toBe(true);
    expect(isLoopbackDevice({ itemName: "Spaces Mixer Tap", itemValue: "SpacesMixerTap_UID", itemEnabled: true })).toBe(true);
    expect(isLoopbackDevice(mics[3])).toBe(false);
  });
});

describe("running apps", () => {
  const sample = `
 6) "Brave Browser" ASN:0x0-0xf00f: (in front) \t    bundleID="com.brave.Browser"
30) "npm exec something" ASN:0x0-0x4f04f: \t    bundleID=[ NULL ]
31) "Brave Browser Helper" ASN:0x0-0x148148: \t    bundleID="com.brave.Browser.helper"
`;
  test("parses names + bundle ids and skips NULL bundle ids", () => {
    expect(parseLsappinfo(sample)).toEqual([
      { name: "Brave Browser", bundleId: "com.brave.Browser" },
      { name: "Brave Browser Helper", bundleId: "com.brave.Browser.helper" },
    ]);
  });
  test("isRunning", () => {
    const apps = parseLsappinfo(sample);
    expect(isRunning(apps, "com.brave.Browser")).toBe(true);
    expect(isRunning(apps, "com.google.Chrome")).toBe(false);
  });
});
