import { expect, test } from "bun:test";
import { MAX_BODY_BYTES, readBody, validateBody } from "../src/request-schema";
for (const [path, body] of [["/api/mute", {input:"mic"}], ["/api/volume", {input:"music"}], ["/api/mute", {input:"mic",muted:"false"}], ["/api/master", {}], ["/api/setup", {browserBundleId:"app\nuntap",micDeviceUid:"mic"}], ["/api/trim", {db:Infinity}], ["/api/mute",null], ["/api/mute",[]], ["/api/obs/prepare",{force:true,extra:1}]] as const) {
  test(`rejects invalid body ${path} ${JSON.stringify(body)}`, () => expect(validateBody(path,body)).toBeDefined());
}
test("explicit silence and false mute are valid", () => {
  expect(validateBody("/api/volume",{input:"music",db:null})).toBeUndefined();
  expect(validateBody("/api/mute",{input:"mic",muted:false})).toBeUndefined();
});
test("malformed JSON rejected", async () => { await expect(readBody(new Request("http://localhost",{method:"POST",body:"{"}))).rejects.toThrow("Invalid JSON"); });
test("streaming body limit enforced without content-length", async () => { await expect(readBody(new Request("http://localhost",{method:"POST",body:'x'.repeat(MAX_BODY_BYTES+1)}))).rejects.toThrow("too large"); });


test("device controls require explicit bounded identity and direction", () => {
  for (const body of [{}, {kind:"input",deviceUid:"mic"}, {kind:"mic",deviceUid:""}, {kind:"output",deviceUid:"x\n"}, {kind:"output",deviceUid:"x".repeat(513)}, {kind:"mic",deviceUid:"mic",extra:true}]) expect(validateBody("/api/device", body)).toBeDefined();
  expect(validateBody("/api/device", {kind:"mic",deviceUid:"USB:1"})).toBeUndefined();
  expect(validateBody("/api/device", {kind:"output",deviceUid:"Speakers"})).toBeUndefined();
  expect(validateBody("/api/master", {volume:.5})).toBeDefined();
  expect(validateBody("/api/master", {deviceUid:"Speakers"})).toBeDefined();
  expect(validateBody("/api/master", {deviceUid:"Speakers",volume:.5})).toBeUndefined();
});
