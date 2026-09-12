import { expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAuth } from "../src/obs-client";

// Actual HTTP controller and OBS protocol, isolated home and executable fake audio helpers. Never contacts installed OBS.
test.skipIf(process.platform === "win32")("controller rejects attacks and verifies sharing start/stop/quit with fake OBS", async () => {
  const directory = mkdtempSync(join(tmpdir(), "spaces-server-test-"));
  const root = join(import.meta.dir, "..");
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let socket: WebSocket | undefined;
  const muted: Record<string, boolean> = { "Mic": false, "Browser Music": false };
  const monitoring: Record<string, string> = { "Mic": "OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT", "Browser Music": "OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT" };
  let profile = "Spaces Mixer";
  let micUid = "test-mic";
  const calls: string[] = [];
  const fake = Bun.serve({hostname:"127.0.0.1",port:0,fetch(req,srv){return srv.upgrade(req)?undefined:new Response(null,{status:400});},websocket:{
    open(ws){ws.send(JSON.stringify({op:0,d:{rpcVersion:1,authentication:{salt:"salt",challenge:"challenge"}}}));},
    message(ws,raw){
      const m=JSON.parse(String(raw));
      if(m.op===1){if(m.d.authentication!==buildAuth("test-password-only","salt","challenge"))return ws.close(4009);return ws.send(JSON.stringify({op:2,d:{negotiatedRpcVersion:1}}));}
      if(m.op!==6)return;
      const {requestType:t,requestData:d={},requestId}=m.d;calls.push(t);
      let r:any={};
      if(t==="GetProfileList")r={currentProfileName:profile};
      if(t==="GetSceneCollectionList")r={currentSceneCollectionName:"Spaces Mixer"};
      if(t==="GetCurrentProgramScene")r={sceneName:"Spaces Mix"};
      if(t==="GetInputList")r={inputs:Object.keys(muted).map(inputName=>({inputName,inputKind:"coreaudio_input_capture"}))};
      if(t==="GetInputSettings")r={inputSettings:{device_id:d.inputName==="Mic"?micUid:"BlackHole16ch_UID"}};
      if(t==="SetInputSettings" && d.inputName==="Mic")micUid=d.inputSettings.device_id;
      if(t.endsWith("Status"))r={outputActive:false};
      if(t==="GetInputVolume")r={inputVolumeDb:-12,inputVolumeMul:.25};
      if(t==="GetInputMute")r={inputMuted:muted[d.inputName]};
      if(t==="SetInputMute")muted[d.inputName]=d.inputMuted;
      if(t==="GetInputAudioMonitorType")r={monitorType:monitoring[d.inputName]};
      if(t==="SetInputAudioMonitorType")monitoring[d.inputName]=d.monitorType;
      if(t==="GetInputPropertiesListPropertyItems")r={propertyItems:[{itemName:"Test mic",itemValue:"test-mic",itemEnabled:true},{itemName:"Second mic",itemValue:"test-mic-2",itemEnabled:true}]};
      ws.send(JSON.stringify({op:7,d:{requestType:t,requestId,requestStatus:{result:true},responseData:r}}));
    }
  }});
  try {
    cpSync(join(root,"src"),join(directory,"src"),{recursive:true});
    cpSync(join(root,"public"),join(directory,"public"),{recursive:true});
    const config = join(directory,"obs");
    mkdirSync(join(config,"plugin_config/obs-websocket"),{recursive:true});
    mkdirSync(join(config,"basic/profiles/Spaces_Mixer"),{recursive:true});
    writeFileSync(join(config,"plugin_config/obs-websocket/config.json"),JSON.stringify({server_enabled:true,auth_required:true,server_password:"test-password-only",server_port:fake.port}));
    writeFileSync(join(config,"user.ini"),'[Basic]\nProfileDir=Spaces_Mixer\n');
    writeFileSync(join(config,"basic/profiles/Spaces_Mixer/basic.ini"),'[Audio]\nMonitoringDeviceId=BlackHole2ch_UID\n');
    const cfgPath=join(directory,"src/obs-config.ts");
    writeFileSync(cfgPath,readFileSync(cfgPath,"utf8").replace(/export const OBS_DIR = .*;/,`export const OBS_DIR = ${JSON.stringify(config)};`));
    writeFileSync(join(directory,"src/obs-process.ts"),'export const isObsRunning=()=>true; export const launchObs=()=>{throw Error("forbidden in test")}; export const quitObs=launchObs; export const waitFor=async()=>false;');
    const srcPath=join(directory,"src/server.ts");
    writeFileSync(srcPath,readFileSync(srcPath,"utf8").replace('const STATE_DIR = join(homedir(), "Library", "Application Support", "spaces-mixer");',`const STATE_DIR = ${JSON.stringify(join(directory,"state"))};`));
    mkdirSync(join(directory,"bin"));
    writeFileSync(join(directory,"bin/sysvol"),`#!/usr/bin/env bun
import {readFileSync,writeFileSync} from "node:fs";
const file=import.meta.dir+"/output.json";
let uid="test-output";try{uid=JSON.parse(readFileSync(file,"utf8")).uid;}catch{}
if(process.argv[2]==="devices")console.log(JSON.stringify([{uid:"test-mic",name:"Test mic",input:true},{uid:"test-mic-2",name:"Second mic",input:true},{uid:"BlackHole16ch_UID",input:true,output:true,virtual:true},{uid:"BlackHole2ch_UID",input:true,output:true,virtual:true},{uid:"test-output",name:"Speakers",output:true},{uid:"test-output-2",name:"Display",output:true}]));
else if(process.argv[2]==="watch")setInterval(()=>{},1000);
else {if(process.argv[2]==="output"){uid=process.argv[3];writeFileSync(file,JSON.stringify({uid}));}console.log(JSON.stringify({volume:uid==="test-output-2"?null:.5,muted:false,device:"Test output",uid}));}`,{mode:0o700});
    writeFileSync(join(directory,"bin/spaces-tap"),'#!/usr/bin/env bun\nconsole.log(JSON.stringify({ready:true}));for await(const chunk of Bun.stdin.stream()){}',{mode:0o700});
    const reserved = Bun.serve({hostname:"127.0.0.1",port:0,fetch:()=>new Response()});
    const port=reserved.port!;reserved.stop(true);
    child=Bun.spawn([process.execPath,"run","src/server.ts"],{cwd:directory,env:{...process.env,HOME:directory,PORT:String(port)},stdout:"pipe",stderr:"pipe"});
    const base=`http://127.0.0.1:${port}`;
    let status:any;
    for(let i=0;i<80;i++){
      try{status=await (await fetch(base+"/api/status")).json();if(status.session.state==="stopped")break;}catch{}
      await Bun.sleep(50);
    }
    expect(status?.session?.state).toBe("stopped");
    expect(muted.Mic).toBe(true);expect(monitoring.Mic).toBe("OBS_MONITORING_TYPE_NONE");
    const post=(path:string,body:string)=>fetch(base+path,{method:"POST",headers:{"content-type":"application/json"},body});
    let before=calls.filter(t=>t.startsWith("Set")).length;
    expect((await post("/api/mute",'{"input":"mic"}')).status).toBe(400);
    expect((await post("/api/obs/prepare",'{')).status).toBe(400);
    expect(calls.filter(t=>t.startsWith("Set")).length).toBe(before);
    expect((await fetch(base+"/api/status",{headers:{host:"evil.invalid"}})).status).toBe(403);
    expect((await fetch(base)).headers.get("x-frame-options")).toBe("DENY");
    expect((await post("/api/mute",'{"input":"mic","muted":false}')).status).toBe(409);
    const deviceList=await (await fetch(base+"/api/devices")).json() as any;
    expect(deviceList.outputs.map((d:any)=>d.uid)).toEqual(["test-output","test-output-2"]);
    expect((await post("/api/device",'{"kind":"output","deviceUid":"BlackHole2ch_UID"}')).status).toBe(500);
    expect((await post("/api/device",'{"kind":"output","deviceUid":"test-output-2"}')).status).toBe(200);
    expect((await post("/api/master",'{"deviceUid":"test-output","volume":0.9}')).status).toBe(409);
    expect((await post("/api/device",'{"kind":"mic","deviceUid":"test-mic-2"}')).status).toBe(200);
    expect(micUid).toBe("test-mic-2");
    expect(muted.Mic).toBe(true);expect(monitoring.Mic).toBe("OBS_MONITORING_TYPE_NONE");
    socket=new WebSocket(base.replace('http:','ws:')+"/ws");
    await new Promise<void>((resolve,reject)=>{socket!.onopen=()=>resolve();socket!.onerror=()=>reject(Error("test socket failed"));});
    expect((await post("/api/session",'{"action":"start"}')).status).toBe(200);
    expect((await post("/api/mute",'{"input":"mic","muted":false}')).status).toBe(200);
    expect(muted.Mic).toBe(false);
    expect((await post("/api/device",'{"kind":"mic","deviceUid":"test-mic"}')).status).toBe(500);
    expect(micUid).toBe("test-mic-2");
    expect((await post("/api/session",'{"action":"stop"}')).status).toBe(200);
    expect(muted.Mic).toBe(true);expect(monitoring.Mic).toBe("OBS_MONITORING_TYPE_NONE");
    profile="Unrelated";before=calls.filter(t=>t.startsWith("Set")).length;
    expect((await post("/api/volume",'{"input":"mic","db":0}')).status).toBe(500);
    expect((await post("/api/obs/prepare",'{"force":true}')).status).toBe(500);
    expect((await post("/api/device",'{"kind":"mic","deviceUid":"test-mic"}')).status).toBe(500);
    expect(calls.filter(t=>t.startsWith("Set")).length).toBe(before);
    profile="Spaces Mixer";
    expect((await post("/api/session",'{"action":"quit"}')).status).toBe(200);
    expect(await child.exited).toBe(0);
  } finally {socket?.close();child?.kill();if(child)await child.exited;fake.stop(true);rmSync(directory,{recursive:true,force:true});}
},10000);
