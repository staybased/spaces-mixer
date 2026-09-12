import { expect, test } from "bun:test";
import { assertIdle, assertOwned } from "../src/obs-safety";
const fake=(values:any)=>({call:async(type:string)=>values[type]??{outputActive:false}}) as any;
test("refuses unrelated profile even in our collection",async()=>{await expect(assertOwned(fake({GetProfileList:{currentProfileName:"Other"},GetSceneCollectionList:{currentSceneCollectionName:"Spaces Mixer"}}))).rejects.toThrow("protected");});
test("accepts exact owned identity",async()=>{await assertOwned(fake({GetProfileList:{currentProfileName:"Spaces Mixer"},GetSceneCollectionList:{currentSceneCollectionName:"Spaces Mixer"}}));});
for(const request of ["GetStreamStatus","GetRecordStatus","GetReplayBufferStatus","GetVirtualCamStatus"]) test(`refuses active ${request}`,async()=>{await expect(assertIdle(fake({[request]:{outputActive:true}}))).rejects.toThrow("Stop OBS");});
test("unknown output state fails closed",async()=>{await expect(assertIdle(fake({GetStreamStatus:{}}))).rejects.toThrow("confirm");});

test("recognizes OBS's unconfigured replay buffer without ignoring other errors",async()=>{
  const {ObsRequestError}=await import("../src/obs-client");
  const obs={call:async(t:string)=>{if(t==="GetReplayBufferStatus")throw new ObsRequestError(t,604,"Replay buffer is not available.");return {outputActive:false};}} as any;
  await assertIdle(obs);
  obs.call=async()=>{throw new ObsRequestError("GetStreamStatus",604,"Replay buffer is not available.");};
  await expect(assertIdle(obs)).rejects.toThrow();
});
