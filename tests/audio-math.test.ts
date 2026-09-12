import { describe, expect, test } from "bun:test";
import { DB_FLOOR, dbToMul, dbToPosition, formatDb, mulToDb, positionToDb } from "../src/audio-math";

describe("audio math", () => {
  test("mul ↔ dB round trip", () => {
    expect(mulToDb(1)).toBeCloseTo(0);
    expect(mulToDb(0.5)).toBeCloseTo(-6.02, 1);
    expect(dbToMul(-6.02)).toBeCloseTo(0.5, 2);
    expect(mulToDb(0)).toBe(DB_FLOOR);
    expect(mulToDb(NaN)).toBe(DB_FLOOR);
    expect(dbToMul(-100)).toBe(0);
  });
  test("fader position mapping", () => {
    expect(positionToDb(1)).toBe(6);
    expect(positionToDb(0.5)).toBe(-27);
    expect(positionToDb(0)).toBe(-Infinity);
    expect(dbToPosition(6)).toBe(1);
    expect(dbToPosition(-27)).toBe(0.5);
    expect(dbToPosition(20)).toBe(1);
    expect(dbToPosition(-Infinity)).toBe(0);
    expect(dbToPosition(-90)).toBe(0);
  });
  test("formatDb", () => {
    expect(formatDb(-12.04)).toBe("-12.0");
    expect(formatDb(0)).toBe("0.0");
    expect(formatDb(2.5)).toBe("+2.5");
    expect(formatDb(-Infinity)).toBe("-inf");
  });
});
