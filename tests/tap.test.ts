import { describe, expect, test } from "bun:test";
import { MUSIC_DEVICE_UID, TAP_DEVICE_UID, parseTapLine } from "../src/tap";

describe("tap daemon lines", () => {
  test("ready line", () => expect(parseTapLine(`{"ready":true,"device":"${TAP_DEVICE_UID}"}`)).toEqual({ bundle: null, processes: 0, device: null, tapping: false }));
  test("status line (bridged into the cable)", () => {
    expect(parseTapLine(`{"bridged":true,"bundle":"org.mozilla.firefox","device":"${MUSIC_DEVICE_UID}","processes":1,"tapping":true}`)).toEqual({ bundle: "org.mozilla.firefox", processes: 1, device: MUSIC_DEVICE_UID, tapping: true, bridged: true, note: undefined, io: undefined });
  });
  test("bare note line is ignored", () => expect(parseTapLine('{"note":"BlackHole 16ch not found"}')).toBeUndefined());
  test("no-processes note", () => {
    const s = parseTapLine('{"bundle":"com.apple.Safari","device":null,"note":"app has no audio processes yet","processes":0,"tapping":false}');
    expect(s).toMatchObject({ tapping: false, processes: 0, note: "app has no audio processes yet" });
  });
  test("error line", () => expect(parseTapLine('{"error":"create tap failed (-1)"}')?.error).toMatch(/create tap failed/));
  test("junk", () => expect(parseTapLine("nope")).toBeUndefined());
});
