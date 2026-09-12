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
