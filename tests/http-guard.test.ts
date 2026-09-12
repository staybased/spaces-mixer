import { describe, expect, test } from "bun:test";
import { mutationAllowed, socketAllowed } from "../src/http-guard";

const h = (o: Record<string, string>) => new Headers(o);

describe("mutation guard", () => {
  test("own origin + json passes", () => {
    expect(mutationAllowed(h({ origin: "http://127.0.0.1:4780", "content-type": "application/json" }), 4780)).toEqual({ ok: true });
  });
  test("no origin (curl) + json passes", () => {
    expect(mutationAllowed(h({ "content-type": "application/json; charset=utf-8" }), 4780).ok).toBe(true);
  });
  test("foreign origin is refused even with json", () => {
    const r = mutationAllowed(h({ origin: "https://evil.example", "content-type": "application/json" }), 4780);
    expect(r.ok).toBe(false);
  });
  test("cross-site text/plain post is refused", () => {
    expect(mutationAllowed(h({ "content-type": "text/plain" }), 4780).ok).toBe(false);
    expect(mutationAllowed(h({}), 4780).ok).toBe(false);
  });
  test("socket origin check", () => {
    expect(socketAllowed(h({}), 4780)).toBe(true);
    expect(socketAllowed(h({ origin: "http://localhost:4780" }), 4780)).toBe(true);
    expect(socketAllowed(h({ origin: "https://x.com" }), 4780)).toBe(false);
  });
});
