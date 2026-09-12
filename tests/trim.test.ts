import { describe, expect, test } from "bun:test";
import { TRIM_MAX_DB, nextTrim } from "../src/trim";

describe("auto-trim", () => {
  test("holds during silence / paused track", () => {
    expect(nextTrim(8, -120)).toBe(8);
    expect(nextTrim(8, -61)).toBe(8);
    expect(nextTrim(8, NaN)).toBe(8);
  });
  test("creeps up toward target at most 2 dB per step", () => {
    expect(nextTrim(0, -40)).toBe(2); // ideal 30 → clamped 18, but only +2 per step
    expect(nextTrim(16, -30)).toBe(18);
    expect(nextTrim(18, -40)).toBe(TRIM_MAX_DB);
  });
  test("drops immediately when too hot", () => {
    expect(nextTrim(12, -6)).toBe(0); // ideal -4 → clamped 0
    expect(nextTrim(12, -16)).toBe(6);
  });
  test("settles exactly at target", () => {
    expect(nextTrim(6, -16)).toBe(6);
    expect(nextTrim(5.5, -15.5)).toBe(5.5);
  });
  test("holds through observed Firefox peak variation without half-decibel hunting", () => {
    let trim = 4;
    for (const peak of [-14.114, -14.934, -14.620, -13.815, -15.009, -14.317, -15.002, -14.112, -13.791]) {
      trim = nextTrim(trim, peak);
      expect(trim).toBe(4);
    }
    expect(nextTrim(trim, -20)).toBe(6);
    expect(nextTrim(trim, -10)).toBe(0);
  });
});
