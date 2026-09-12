import { expect, test } from "bun:test";
import { Sharing } from "../src/sharing";
function fixture(fail = "", profile="Spaces Mixer") {
  const calls:any[]=[];const capture:any[]=[];
  const obs={connected:true,call:async(type:string,data?:any)=>{calls.push({type,data});if(type===fail)throw Error("RPC failed");
    if(type==="GetProfileList")return {currentProfileName:profile};
    if(type==="GetSceneCollectionList")return {currentSceneCollectionName:"Spaces Mixer"};
    if(type==="GetCurrentProgramScene")return {sceneName:"Spaces Mix"};
    if(type==="GetInputList")return {inputs:[{inputName:"Mic"},{inputName:"Browser Music"}]};
    if(type==="GetInputMute")return {inputMuted:true};
    if(type==="GetInputAudioMonitorType")return {monitorType:"OBS_MONITORING_TYPE_NONE"};return {};}};
  const s=new Sharing(()=>obs as any,{set:(app)=>capture.push(app),clear:()=>capture.push("clear")},()=>{});
  return {s,calls,capture,obs};
}
test("constructing a session does not capture",()=>{const f=fixture();expect(f.capture).toEqual([]);expect(f.s.active).toBe(false);});
test("stop acknowledges both mutes and monitoring; start never unmutes",async()=>{const f=fixture();await f.s.stop();expect(f.s.state.state).toBe("stopped");await f.s.start("music.app");expect(f.s.active).toBe(true);expect(f.capture.at(-1)).toBe("music.app");expect(f.calls.some(c=>c.type==="SetInputMute"&&c.data.inputMuted===false)).toBe(false);await f.s.stop();expect(f.s.active).toBe(false);});
test("failed stop remains visibly unconfirmed",async()=>{const f=fixture("SetInputMute");await expect(f.s.stop()).rejects.toThrow();expect(f.s.state.state).toBe("error");expect(f.calls.filter(c=>c.type==="SetInputAudioMonitorType")).toHaveLength(2);});
test("unrelated OBS receives no mutations",async()=>{const f=fixture("","Other");await expect(f.s.stop()).rejects.toThrow();expect(f.calls.some(c=>c.type.startsWith("Set"))).toBe(false);});
test("disconnect clears capture and never claims silence",()=>{const f=fixture();f.s.disconnected();expect(f.capture).toEqual(["clear"]);expect(f.s.state.state).toBe("error");});
