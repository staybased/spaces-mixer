import { createHash } from "node:crypto";

/** obs-websocket v5 event subscription bits: everything normal plus InputVolumeMeters. */
export const EVENT_SUBSCRIPTIONS = 0x7ff | (1 << 16);
export const IDENTIFY_TIMEOUT_MS = 6000;
export const REQUEST_TIMEOUT_MS = 10000;

/** obs-websocket close codes worth naming for the user. */
export const CLOSE_REASONS: Record<number, string> = {
  4005: "OBS rejected the WebSocket password",
  4009: "OBS rejected the WebSocket password",
  4010: "obs-websocket RPC version mismatch",
  4011: "OBS closed the session",
};

export class ObsRequestError extends Error {
  constructor(readonly requestType: string, readonly code: number, readonly comment: string) { super(`${requestType}: ${comment || `code ${code}`}`); }
}

export type ObsEvent = { eventType: string; eventData: Record<string, any> };
type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

export function buildAuth(password: string, salt: string, challenge: string): string {
  const secret = createHash("sha256").update(password + salt).digest("base64");
  return createHash("sha256").update(secret + challenge).digest("base64");
}

export function identifyPayload(hello: any, password: string): Record<string, unknown> {
  const base = { rpcVersion: 1, eventSubscriptions: EVENT_SUBSCRIPTIONS };
  if (!hello?.authentication) return base;
  const { salt, challenge } = hello.authentication;
  return { ...base, authentication: buildAuth(password, salt, challenge) };
}

export function describeClose(code: number, reason: string): string {
  return CLOSE_REASONS[code] ?? (reason ? `OBS closed the connection: ${reason}` : `OBS connection closed (code ${code})`);
}

export class ObsClient {
  private ws?: WebSocket;
  private pending = new Map<string, Pending>();
  private seq = 0;
  private listeners = new Set<(e: ObsEvent) => void>();
  private identified = false;
  /** Set when the socket closes; human-readable. */
  lastError?: string;
  onClose?: (client: ObsClient) => void;

  constructor(
    private readonly url: string,
    private readonly password: string,
    private readonly timeouts = { identify: IDENTIFY_TIMEOUT_MS, request: REQUEST_TIMEOUT_MS },
  ) {}

  get connected(): boolean {
    return this.identified;
  }

  onEvent(fn: (e: ObsEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let helloReceived = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(identifyTimer);
        fn();
      };
      const ws = new WebSocket(this.url);
      this.ws = ws;
      const identifyTimer = setTimeout(() => {
        this.lastError = "OBS did not complete the WebSocket handshake in time";
        settle(() => reject(new Error(this.lastError)));
        ws.close();
      }, this.timeouts.identify);
      ws.onerror = () => {
        this.lastError ??= "OBS WebSocket connection failed";
        settle(() => reject(new Error(this.lastError)));
      };
      ws.onclose = (ev) => {
        this.identified = false;
        this.lastError = describeClose(ev.code, ev.reason);
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(new Error("OBS disconnected"));
        }
        this.pending.clear();
        settle(() => reject(new Error(this.lastError)));
        this.onClose?.(this);
      };
      ws.onmessage = (m) => {
        try {
        const raw = String(m.data);
        if (raw.length > 1024 * 1024) throw new Error("OBS frame too large");
        const msg = JSON.parse(raw);
        if (!msg || typeof msg !== "object" || !Number.isInteger(msg.op) || !msg.d || typeof msg.d !== "object" || Array.isArray(msg.d)) throw new Error("Invalid OBS frame");
        if (msg.op === 0) {
          if (helloReceived || this.identified) throw new Error("Unexpected OBS hello");
          helloReceived = true;
          const auth = msg.d.authentication;
          if (auth && (typeof auth.salt !== "string" || typeof auth.challenge !== "string")) throw new Error("Invalid OBS authentication challenge");
          ws.send(JSON.stringify({ op: 1, d: identifyPayload(msg.d, this.password) }));
          return;
        }
        if (msg.op === 2) {
          if (!helloReceived || this.identified) throw new Error("Unexpected OBS identification");
          this.identified = true;
          this.lastError = undefined;
          settle(resolve);
          return;
        }
        if ((msg.op === 7 || msg.op === 5) && !this.identified) throw new Error("OBS message before identification");
        if (msg.op === 7) return this.handleResponse(msg.d);
        if (msg.op === 5) {
          if (typeof msg.d.eventType !== "string" || !msg.d.eventData || typeof msg.d.eventData !== "object") throw new Error("Invalid OBS event");
          for (const fn of this.listeners) fn(msg.d);
        }
        } catch {
          this.lastError = "OBS sent an invalid protocol message";
          settle(() => reject(new Error(this.lastError)));
          ws.close(1002, "Invalid protocol message");
        }
      };
    });
  }

  private handleResponse(d: any): void {
    if (typeof d.requestId !== "string" || typeof d.requestStatus?.result !== "boolean") throw new Error("Invalid OBS response");
    const p = this.pending.get(d.requestId);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(d.requestId);
    if (d.requestStatus?.result) return p.resolve(d.responseData ?? {});
    p.reject(new ObsRequestError(d.requestType, d.requestStatus.code, d.requestStatus.comment ?? ""));
  }

  call<T = any>(requestType: string, requestData: Record<string, unknown> = {}): Promise<T> {
    if (!this.ws || !this.identified) return Promise.reject(new Error("OBS not connected"));
    if (this.pending.size >= 64) return Promise.reject(new Error("Too many pending OBS requests"));
    const requestId = `r${++this.seq}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`${requestType}: OBS did not answer within ${this.timeouts.request / 1000}s`));
      }, this.timeouts.request);
      this.pending.set(requestId, { resolve, reject, timer });
      try { this.ws!.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } })); }
      catch { clearTimeout(timer); this.pending.delete(requestId); reject(new Error("OBS send failed")); }
    });
  }

  /** Wait for one event of a type, or time out. */
  waitForEvent(eventType: string, timeoutMs: number): Promise<Record<string, any> | undefined> {
    return new Promise((resolve) => {
      const off = this.onEvent((e) => {
        if (e.eventType !== eventType) return;
        clearTimeout(t);
        off();
        resolve(e.eventData);
      });
      const t = setTimeout(() => {
        off();
        resolve(undefined);
      }, timeoutMs);
    });
  }

  close(): void {
    this.ws?.close();
  }
}
