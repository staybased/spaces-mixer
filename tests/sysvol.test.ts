import { describe, expect, test } from "bun:test";
import { clamp01, parseDevices, parseMasterLine } from "../src/sysvol";

describe("sysvol", () => {
  test("parses a helper line", () => {
    expect(parseMasterLine('{"volume":0.626,"muted":false,"device":"CalDigit"}')).toEqual({ volume: 0.626, muted: false, device: "CalDigit" });
  });
  test("null volume when device has no main volume", () => {
    expect(parseMasterLine('{"volume":null,"muted":null,"device":"X"}')).toEqual({ volume: null, muted: null, device: "X" });
  });
  test("device names with quotes/backslashes survive (helper uses JSONSerialization)", () => {
    expect(parseMasterLine('{"device":"Bob\\u0027s \\"Odd\\\\ Device","muted":false,"volume":0.5}')?.device).toBe('Bob\'s "Odd\\ Device');
  });
  test("ignores junk", () => {
    expect(parseMasterLine("warning: something")).toBeUndefined();
    expect(parseMasterLine("{}")).toBeUndefined();
  });
  test("parseDevices filters entries without uid", () => {
    const d = parseDevices('[{"name":"BlackHole 2ch","uid":"BlackHole2ch_UID","input":true,"output":true},{"name":"ghost","uid":"","input":true,"output":false}]');
    expect(d).toEqual([{ name: "BlackHole 2ch", uid: "BlackHole2ch_UID", input: true, output: true }]);
    expect(parseDevices("nope")).toEqual([]);
  });
  test("clamp01", () => {
    expect(clamp01(1.4)).toBe(1);
    expect(clamp01(-2)).toBe(0);
    expect(clamp01(0.3)).toBe(0.3);
  });
});


test("device identity and virtual transport survive helper parsing", () => {
  expect(parseMasterLine('{"volume":null,"muted":null,"device":"Display","uid":"hdmi"}')?.uid).toBe("hdmi");
  expect(parseDevices('[{"uid":"aggregate","name":"My mix","input":true,"output":true,"virtual":true}]')[0].virtual).toBe(true);
});
