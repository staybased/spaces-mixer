import type { ObsClient } from "./obs-client";
import { assertOwned } from "./obs-safety";
import { NAMES } from "./setup";
export type SharingState = { state: "unverified" | "stopped" | "starting" | "sharing" | "stopping" | "error"; error?: string };
/** No audio capture at construction; failed/disconnected OBS never means confirmed silence. */
export class Sharing {
  state: SharingState = { state: "unverified" };
  private busy = false;
  constructor(private obs: () => ObsClient | undefined, private capture: { set(app: string): void; clear(): void }, private changed: (state: SharingState) => void) {}
  private update(state: SharingState) { this.state = state; this.changed(state); }
  get active() { return this.state.state === "sharing"; }
  disconnected() { this.capture.clear(); this.update({ state: "error", error: "OBS disconnected. Verify the destination is muted; stop is not confirmed." }); }
  async stop(): Promise<void> {
    if (this.busy) throw new Error("Sharing operation is in progress");
    this.busy = true;
    this.update({ state: "stopping" });
    this.capture.clear();
    try {
      const obs = this.obs();
      if (!obs?.connected) throw new Error("OBS unavailable. Mute the destination directly; stop cannot be confirmed.");
      await assertOwned(obs);
      const { inputs } = await obs.call("GetInputList");
      const names = [NAMES.music, NAMES.mic].filter((name) => inputs.some((i: any) => i.inputName === name));
      const results = await Promise.allSettled(names.flatMap((inputName) => [
        obs.call("SetInputMute", { inputName, inputMuted: true }),
        obs.call("SetInputAudioMonitorType", { inputName, monitorType: "OBS_MONITORING_TYPE_NONE" }),
      ]));
      if (results.some((r) => r.status === "rejected")) throw new Error("OBS did not acknowledge every stop command");
      for (const inputName of names) {
        const [mute, monitor] = await Promise.all([obs.call("GetInputMute", { inputName }), obs.call("GetInputAudioMonitorType", { inputName })]);
        if (mute.inputMuted !== true || monitor.monitorType !== "OBS_MONITORING_TYPE_NONE") throw new Error("OBS stop state did not match the requested state");
      }
      await assertOwned(obs);
      if (!obs.connected || this.obs() !== obs) throw new Error("OBS changed during stop; silence is unconfirmed");
      this.update({ state: "stopped" });
    } catch (error) { this.update({ state: "error", error: (error as Error).message }); throw error; }
    finally { this.busy = false; }
  }
  async start(app: string): Promise<void> {
    if (this.busy || this.state.state !== "stopped") throw new Error("Confirm Stop sharing before starting a new session");
    this.busy = true;
    this.update({ state: "starting" });
    try {
      const obs = this.obs();
      if (!obs?.connected) throw new Error("OBS is disconnected");
      await assertOwned(obs, true);
      for (const inputName of [NAMES.music, NAMES.mic]) {
        const { inputMuted } = await obs.call("GetInputMute", { inputName });
        if (inputMuted !== true) throw new Error("Both sources must be muted before starting");
      }
      for (const inputName of [NAMES.music, NAMES.mic]) await obs.call("SetInputAudioMonitorType", { inputName, monitorType: "OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT" });
      if (!obs.connected || this.obs() !== obs) throw new Error("OBS changed during start");
      this.capture.set(app);
      this.update({ state: "sharing" }); // still muted; the user chooses which source to unmute
    } catch (error) {
      this.capture.clear();
      this.update({ state: "error", error: (error as Error).message });
      throw error;
    } finally { this.busy = false; }
  }
}
