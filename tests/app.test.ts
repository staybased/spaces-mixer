import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

// Run the real dashboard with a minimal DOM and deterministic timers. No OBS or audio devices.
class Element {
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  children = new Map<string, Element>();
  listeners = new Map<string, Function>();
  classes = new Set<string>();
  classList = {
    toggle: (name: string, on: boolean) => on ? this.classes.add(name) : this.classes.delete(name),
    contains: (name: string) => this.classes.has(name),
    remove: (name: string) => this.classes.delete(name),
    add: (name: string) => this.classes.add(name),
  };
  style = { setProperty() {} };
  textContent = "";
  innerHTML = "";
  hidden = true;
  disabled = false;
  tabIndex = 0;
  querySelector(key: string): Element {
    if (!this.children.has(key)) this.children.set(key, new Element());
    return this.children.get(key)!;
  }
  querySelectorAll() { return []; }
  setAttribute(key: string, value: unknown) { this.attributes.set(key, String(value)); }
  getAttribute(key: string) { return this.attributes.get(key) ?? null; }
  addEventListener(key: string, fn: Function) { this.listeners.set(key, fn); }
}

function dashboard() {
  const document = new Element();
  const music = new Element(); music.dataset.input = "music";
  const mic = new Element(); mic.dataset.input = "mic";
  document.querySelectorAll = () => [music, mic];
  const timers = new Map<number, Function>();
  let seq = 0;
  const requests: { path: string; body?: string }[] = [];
  const context = createContext({
    document, URLSearchParams, location: { search: "", host: "127.0.0.1:4780" },
    WebSocket: class {},
    fetch: (path: string, options?: { body: string }) => {
      requests.push({ path, body: options?.body });
      return new Promise(() => {});
    },
    setTimeout: (fn: Function) => { timers.set(++seq, fn); return seq; },
    clearTimeout: (id: number) => timers.delete(id),
    setInterval() {},
  });
  runInContext(readFileSync(new URL("../public/app.js", import.meta.url), "utf8"), context);
  return {
    evaluate: (code: string) => runInContext(code, context), requests, music, document,
    tick: () => { const ready = [...timers.values()]; timers.clear(); ready.forEach((fn) => fn()); },
  };
}

describe("dashboard controls", () => {
  test("slow OBS replies serialize drag sends and preserve the final silence value", async () => {
    const page = dashboard();
    page.evaluate("var sent = [], complete; var sender = makeSender(v => { sent.push(v); return new Promise(r => complete = r); }); sender.push(-12); sender.flush()");
    page.evaluate("sender.push(-6); sender.flush(); sender.push(null); sender.flush()");
    expect(page.evaluate("sent")).toEqual([-12]);
    page.evaluate("complete()");
    await Promise.resolve();
    expect(page.evaluate("sent")).toEqual([-12, null]);
    page.evaluate("sender.push(0); sender.cancel(); complete()");
    await Promise.resolve();
    page.tick();
    expect(page.evaluate("sent")).toEqual([-12, null]);
  });

  test("throttles a drag and flushes its final silence value exactly once", () => {
    const page = dashboard();
    page.evaluate("var sent = []; var sender = makeSender(v => sent.push(v)); sender.push(-12); sender.push(-6)");
    expect(page.evaluate("sent")).toEqual([]);
    page.tick();
    expect(page.evaluate("sent")).toEqual([-6]);
    page.evaluate("sender.push(-3); sender.push(null); sender.flush()");
    page.tick();
    expect(page.evaluate("sent")).toEqual([-6, null]);
  });

  test("silence is also delivered by the timer and cancel discards queued changes", () => {
    const page = dashboard();
    page.evaluate("var sent = []; var sender = makeSender(v => sent.push(v)); sender.push(null)");
    page.tick();
    page.evaluate("sender.push(0); sender.cancel()");
    page.tick();
    expect(page.evaluate("sent")).toEqual([null]);
  });

  test("offline faders ignore keyboard input and are removed from tab order", () => {
    const page = dashboard();
    page.evaluate("applyState(null)");
    const fader = page.music.querySelector(".fader");
    fader.listeners.get("keydown")!({ key: "ArrowUp" });
    page.tick();
    expect(fader.getAttribute("aria-disabled")).toBe("true");
    expect(fader.tabIndex).toBe(-1);
    expect(page.requests.filter((r) => r.body)).toEqual([]);
  });

  test("disconnect cancels queued fader changes and offlines headphones too", () => {
    const page = dashboard();
    page.evaluate('applyState({music:{exists:true,volumeDb:-12,muted:false}}); strips.music.sender.push(-6); applyMaster({volume:.5,muted:false,device:"Phones"}); controllerOffline()');
    page.tick();
    expect(page.requests.filter((r) => r.body)).toEqual([]);
    expect(page.document.querySelector(".strip.master").querySelector(".fader").getAttribute("aria-disabled")).toBe("true");
    expect(page.music.querySelector(".readout").innerHTML).toBe("—");
  });

  test("pending mute cannot be re-enabled by a state refresh", () => {
    const page = dashboard();
    page.evaluate('applyState({music:{exists:true,volumeDb:-12,muted:false}})');
    const mute = page.music.querySelector(".mute");
    mute.listeners.get("click")!();
    page.evaluate('applyState({music:{exists:true,volumeDb:-12,muted:false}})');
    expect(mute.disabled).toBe(true);
    expect(mute.getAttribute("aria-pressed")).toBe("false");
  });
});

test("sharing controls never offer Start before stop is confirmed", () => {
  const page=dashboard();
  page.evaluate('renderSession({state:"error",error:"Stop unconfirmed"})');
  expect(page.document.querySelector("#btn-start").disabled).toBe(true);
  page.evaluate('renderSession({state:"stopped"})');
  expect(page.document.querySelector("#btn-start").disabled).toBe(false);
  page.evaluate('renderSession({state:"sharing"})');
  expect(page.document.querySelector("#btn-start").disabled).toBe(true);
});
