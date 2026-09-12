export const MAX_BODY_BYTES = 8192;
export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export const isBundleId = (v: unknown): v is string => typeof v === "string" && v.length <= 255 && /^[A-Za-z0-9._-]+$/.test(v);
const number = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const text = (v: unknown) => typeof v === "string" && v.length > 0 && v.length <= 512 && !/[\x00-\x1f\x7f]/.test(v);
const schemas: Record<string, Record<string, (v: unknown) => boolean>> = {
  "/api/obs/prepare": { force: (v) => typeof v === "boolean" },
  "/api/setup": { browserBundleId: isBundleId, micDeviceUid: text },
  "/api/volume": { input: (v) => v === "music" || v === "mic", db: (v) => v === null || number(v, -100, 26) },
  "/api/mute": { input: (v) => v === "music" || v === "mic", muted: (v) => typeof v === "boolean" },
  "/api/master": { volume: (v) => number(v, 0, 1), muted: (v) => typeof v === "boolean" },
  "/api/source": { bundleId: isBundleId },
  "/api/trim": { auto: (v) => typeof v === "boolean", db: (v) => number(v, -20, 30) },
  "/api/session": { action: (v) => v === "start" || v === "stop" || v === "quit" },
};
export function validateBody(path: string, body: unknown): string | undefined {
  const schema = schemas[path];
  if (!schema) return "Unknown action";
  if (!isRecord(body)) return "JSON body must be an object";
  const keys = Object.keys(body);
  if (keys.some((k) => !Object.hasOwn(schema, k) || !schema[k](body[k]))) return "Invalid or unexpected field";
  if (path === "/api/obs/prepare") return;
  if (path === "/api/master" || path === "/api/trim") return keys.length ? undefined : "At least one setting is required";
  if (Object.keys(schema).some((k) => !Object.hasOwn(body, k))) return "Required field missing";
}
export class RequestError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
export async function readBody(req: Request): Promise<unknown> {
  const length = req.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) throw new RequestError("Request too large", 413);
  const reader = req.body?.getReader();
  if (!reader) throw new RequestError("JSON body required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { void reader.cancel(); throw new RequestError("Request too large", 413); }
      chunks.push(value);
    }
    const data = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)); }
    catch { throw new RequestError("Invalid JSON"); }
  } finally { reader.releaseLock(); }
}
