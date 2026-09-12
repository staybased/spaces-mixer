import { expect, test } from "bun:test";
import { createRouter } from "../src/http-router";
function fixture() {
  let calls=0;
  const handler=()=>{calls++;return Response.json({ok:true});};
  const route=createRouter(4780,{"/":handler,"/api/status":handler},{"/api/mute":handler,"/api/volume":handler,"/api/obs/prepare":handler},()=>{calls++;return true;});
  const request=(path:string,method="GET",body?:string,headers:Record<string,string>={})=>route(new Request(`http://127.0.0.1:4780${path}`,{method,body,headers:{host:"127.0.0.1:4780","content-type":"application/json",...headers}}),{});
  return {request,calls:()=>calls};
}
for(const path of ["/","/api/status","/ws","/api/mute"]) test(`foreign Host rejected: ${path}`,async()=>{const f=fixture();expect((await f.request(path,path==="/api/mute"?"POST":"GET",undefined,{host:"example.invalid:4780"}))?.status).toBe(403);expect(f.calls()).toBe(0);});
for(const [path,body,headers,status] of [["/api/mute",'{"input":"mic"}',{},400],["/api/volume",'{"input":"music"}',{},400],["/api/obs/prepare",'{',{},400],["/api/mute",'{"input":"mic","muted":false}',{"content-type":"application/jsonp"},403],["/api/mute",'{"input":"mic","muted":false}',{origin:"null"},403]] as const) test(`invalid request causes no side effect: ${path} ${body} ${JSON.stringify(headers)}`,async()=>{const f=fixture();expect((await f.request(path,"POST",body,headers))?.status).toBe(status);expect(f.calls()).toBe(0);});
test("valid mutation and security headers",async()=>{const f=fixture();const r=await f.request("/api/mute","POST",'{"input":"mic","muted":false}');expect(r?.status).toBe(200);expect(f.calls()).toBe(1);expect(r?.headers.get("x-frame-options")).toBe("DENY");expect(r?.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");});
test("unknown/prototype route is not dispatched",async()=>{const f=fixture();expect((await f.request("/constructor"))?.status).toBe(404);expect(f.calls()).toBe(0);});

test("bounds concurrent requests and recovers capacity", async () => {
  let release!:()=>void;
  const gate=new Promise<void>(r=>release=r);
  const route=createRouter(4780,{"/api/status":async()=>{await gate;return Response.json({ok:true});}},{},()=>false);
  const request=()=>route(new Request("http://127.0.0.1:4780/api/status",{headers:{host:"127.0.0.1:4780"}}),{});
  const pending=Array.from({length:16},request);
  expect((await request())?.status).toBe(503);
  release();await Promise.all(pending);
  expect((await request())?.status).toBe(200);
});
