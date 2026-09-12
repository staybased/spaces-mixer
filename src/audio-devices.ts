import type { ObsClient } from "./obs-client";
import { assertIdle, assertOwned } from "./obs-safety";
import { isLoopbackDevice, KINDS, listMics, NAMES } from "./setup";
import type { AudioDevice, MasterState } from "./sysvol";

export const physicalDevices = (devices: AudioDevice[], direction: "input" | "output"): AudioDevice[] =>
  devices.filter((d) => d[direction] && !d.virtual && d.uid !== "default" && !isLoopbackDevice({ itemName: d.name, itemValue: d.uid, itemEnabled: true }));

/** A mic change never rebuilds the mix or resumes capture. The caller serializes controls. */
export async function selectMic(obs: ObsClient, uid: string, devices: AudioDevice[], session: { state: { state: string }; stop(): Promise<void> }): Promise<void> {
  if (session.state.state !== "stopped") throw new Error("Stop sharing before changing the microphone");
  await assertOwned(obs, true);
  await assertIdle(obs);
  const { inputs } = await obs.call("GetInputList");
  if (!inputs.some((i: any) => i.inputName === NAMES.mic && i.inputKind === KINDS.micInput)) throw new Error("Build the mix in Setup before selecting a microphone");
  if (!physicalDevices(devices, "input").some((d) => d.uid === uid)
      || !(await listMics(obs)).some((d) => d.itemValue === uid && d.itemEnabled !== false)) throw new Error("The selected microphone is unavailable; reconnect it or choose another");
  await session.stop();
  try {
    await obs.call("SetInputSettings", { inputName: NAMES.mic, inputSettings: { device_id: uid }, overlay: true });
  } finally {
    // An RPC failure can arrive after OBS applied the change. Reconfirm silence either way.
    await session.stop();
  }
  const { inputSettings } = await obs.call("GetInputSettings", { inputName: NAMES.mic });
  if (inputSettings?.device_id !== uid) throw new Error("OBS did not confirm the selected microphone");
}

export function selectOutput(uid: string, devices: AudioDevice[], set: (uid: string) => boolean, get: () => MasterState | undefined): MasterState {
  if (!physicalDevices(devices, "output").some((d) => d.uid === uid)) throw new Error("The selected output is unavailable; choose connected speakers or headphones");
  if (!set(uid)) throw new Error("macOS could not switch the output device; refresh and check Sound settings");
  const state = get();
  if (state?.uid !== uid) throw new Error("macOS did not confirm the selected output; refresh and check Sound settings");
  return state;
}
