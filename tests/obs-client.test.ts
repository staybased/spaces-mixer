import { createHash } from "node:crypto";
import { afterAll, describe, expect, test } from "bun:test";
import { EVENT_SUBSCRIPTIONS, ObsClient, buildAuth, describeClose, identifyPayload } from "../src/obs-client";

describe("obs-websocket v5 identify", () => {
  test("buildAuth matches the documented two-step sha256/base64", () => {
    const secret = createHash("sha256").update("pw" + "salt").digest("base64");
    const expected = createHash("sha256").update(secret + "chal").digest("base64");
    expect(buildAuth("pw", "salt", "chal")).toBe(expected);
  });
  test("identify includes auth only when hello asks for it", () => {
    expect(identifyPayload({}, "pw")).toEqual({ rpcVersion: 1, eventSubscriptions: EVENT_SUBSCRIPTIONS });
    const withAuth = identifyPayload({ authentication: { salt: "s", challenge: "c" } }, "pw") as any;
    expect(withAuth.authentication).toBe(buildAuth("pw", "s", "c"));
  });
  test("subscribes to InputVolumeMeters (bit 16) plus all normal events", () => {
    expect(EVENT_SUBSCRIPTIONS & (1 << 16)).toBeTruthy();
    expect(EVENT_SUBSCRIPTIONS & 0x7ff).toBe(0x7ff);
  });
  test("close codes are explained", () => {
    expect(describeClose(4009, "")).toMatch(/password/);
    expect(describeClose(1006, "")).toMatch(/1006/);
  });
});

/** A fake obs-websocket: Hello → expects Identify → Identified; answers GetVersion; never answers "Hang". */
function fakeObs(opts: { password?: string; hang?: boolean; rejectAuth?: boolean } = {}) {
  const server = Bun.serve<{}>({
    port: 0,
    fetch(req, srv) {
      return srv.upgrade(req) ? undefined : new Response("no", { status: 400 });
    },
    websocket: {
      open(ws) {
        const auth = opts.password ? { challenge: "c1", salt: "s1" } : undefined;
        ws.send(JSON.stringify({ op: 0, d: { obsWebSocketVersion: "5.5.0", rpcVersion: 1, authentication: auth } }));
      },
      message(ws, raw) {
        const msg = JSON.parse(String(raw));
        if (msg.op === 1) {
          if (opts.rejectAuth) return ws.close(4009, "Authentication failed.");
          if (opts.hang) return;
          return ws.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }));
        }
        if (msg.op === 6) {
          if (msg.d.requestType === "Hang") return;
          ws.send(JSON.stringify({ op: 7, d: { requestType: msg.d.requestType, requestId: msg.d.requestId, requestStatus: { result: true, code: 100 }, responseData: { obsVersion: "32.0" } } }));
        }
      },
    },
  });
  return server;
}

describe("ObsClient lifecycle", () => {
  const servers: ReturnType<typeof Bun.serve>[] = [];
  afterAll(() => servers.forEach((s) => s.stop(true)));

  test("connects, identifies with auth, round-trips a request", async () => {
    const s = fakeObs({ password: "pw" }); servers.push(s);
    const c = new ObsClient(`ws://127.0.0.1:${s.port}`, "pw", { identify: 1000, request: 1000 });
    await c.connect();
    expect(c.connected).toBe(true);
    const r = await c.call("GetVersion");
    expect(r.obsVersion).toBe("32.0");
    c.close();
  });
  test("request timeout rejects instead of hanging", async () => {
    const s = fakeObs(); servers.push(s);
    const c = new ObsClient(`ws://127.0.0.1:${s.port}`, "", { identify: 1000, request: 150 });
    await c.connect();
    await expect(c.call("Hang")).rejects.toThrow(/did not answer/);
    c.close();
  });
  test("identify timeout rejects", async () => {
    const s = fakeObs({ hang: true }); servers.push(s);
    const c = new ObsClient(`ws://127.0.0.1:${s.port}`, "", { identify: 150, request: 1000 });
    await expect(c.connect()).rejects.toThrow(/handshake/);
  });
  test("wrong password surfaces a readable error and fires onClose with the client", async () => {
    const s = fakeObs({ password: "pw", rejectAuth: true }); servers.push(s);
    const c = new ObsClient(`ws://127.0.0.1:${s.port}`, "wrong", { identify: 1000, request: 1000 });
    let closedWith: ObsClient | undefined;
    c.onClose = (x) => { closedWith = x; };
    await expect(c.connect()).rejects.toThrow(/password/);
    expect(closedWith).toBe(c);
    expect(c.lastError).toMatch(/password/);
  });
  test("call() before connect rejects", async () => {
    const c = new ObsClient("ws://127.0.0.1:1", "");
    await expect(c.call("GetVersion")).rejects.toThrow(/not connected/);
  });
});

test("malformed OBS messages reject the handshake without an uncaught parser error", async () => {
  const s = Bun.serve({hostname:"127.0.0.1",port:0,fetch(req,srv){return srv.upgrade(req)?undefined:new Response(null,{status:400});},websocket:{open(ws){ws.send("{");},message(){}}});
  const c = new ObsClient(`ws://127.0.0.1:${s.port}`, "", {identify:500,request:500});
  try { await expect(c.connect()).rejects.toThrow("invalid protocol"); expect(c.connected).toBe(false); }
  finally { c.close(); s.stop(true); }
});
