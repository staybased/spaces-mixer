import { describe, expect, test } from "bun:test";
import { captureCandidates, runningBrowserCount } from "../src/capture-sources";

const running = [
  { name: "Brave Browser", bundleId: "com.brave.Browser" },
  { name: "Brave Browser Helper", bundleId: "com.brave.Browser.helper" },
  { name: "Spotify", bundleId: "com.spotify.client" },
  { name: "Finder", bundleId: "com.apple.finder" },
  { name: "Zen", bundleId: "app.zen-browser.zen" },
  { name: "Some Player", bundleId: "io.example.player" },
  { name: "Codex", bundleId: "com.openai.codex" },
];

describe("captureCandidates", () => {
  const list = captureCandidates(running);
  test("known browsers always listed, running flag correct", () => {
    expect(list.find((s) => s.bundleId === "com.brave.Browser")).toMatchObject({ running: true, group: "browser" });
    expect(list.find((s) => s.bundleId === "com.apple.Safari")).toMatchObject({ running: false, group: "browser" });
  });
  test("known players listed", () => expect(list.find((s) => s.bundleId === "com.spotify.client")).toMatchObject({ running: true, group: "player" }));
  test("unknown running browser grouped as browser, unknown app as other", () => {
    expect(list.find((s) => s.bundleId === "app.zen-browser.zen")).toMatchObject({ group: "browser", running: true });
    expect(list.find((s) => s.bundleId === "io.example.player")).toMatchObject({ group: "other", running: true });
  });
  test("helpers, system apps and dev tools hidden", () => {
    const ids = list.map((s) => s.bundleId);
    expect(ids).not.toContain("com.brave.Browser.helper");
    expect(ids).not.toContain("com.apple.finder");
    expect(ids).not.toContain("com.openai.codex");
  });
  test("no duplicates", () => expect(new Set(list.map((s) => s.bundleId)).size).toBe(list.length));
  test("runningBrowserCount counts only running browsers", () => expect(runningBrowserCount(list)).toBe(2));
});
