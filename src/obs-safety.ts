import { ObsRequestError, type ObsClient } from "./obs-client";
import { NAMES } from "./setup";
export const PROFILE = "Spaces Mixer";
/** Every control operation checks current identity; connection alone never grants ownership. */
export async function assertOwned(obs: ObsClient, scene = false): Promise<void> {
  const [profile, collection] = await Promise.all([obs.call("GetProfileList"), obs.call("GetSceneCollectionList")]);
  if (profile.currentProfileName !== PROFILE || collection.currentSceneCollectionName !== NAMES.collection) {
    throw new Error("Select the Spaces Mixer profile and scene collection in OBS. Other setups are protected.");
  }
  if (scene) {
    const current = await obs.call("GetCurrentProgramScene");
    if ((current.sceneName ?? current.currentProgramSceneName) !== NAMES.scene) throw new Error("Select the Spaces Mix scene in OBS");
  }
}
export async function assertIdle(obs: ObsClient): Promise<void> {
  for (const request of ["GetStreamStatus", "GetRecordStatus", "GetReplayBufferStatus", "GetVirtualCamStatus"]) {
    let result;
    try { result = await obs.call(request); }
    catch (error) {
      // OBS reports this exact status when the replay buffer is not configured. Other failures stay fatal.
      if (request === "GetReplayBufferStatus" && error instanceof ObsRequestError && error.code === 604 && error.comment === "Replay buffer is not available.") continue;
      throw error;
    }
    if (typeof result.outputActive !== "boolean") throw new Error("Could not confirm OBS output state");
    if (result.outputActive) throw new Error("Stop OBS streaming, recording, replay buffer and virtual camera before setup");
  }
}
