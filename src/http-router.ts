import { hostAllowed, mutationAllowed, socketAllowed } from "./http-guard";
import { MAX_BODY_BYTES, readBody, RequestError, validateBody } from "./request-schema";
export { MAX_BODY_BYTES };
export const securityHeaders = (port: number): Record<string, string> => ({
  "content-security-policy": `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:${port} ws://localhost:${port}; img-src 'self' data:; font-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'`,
  "x-frame-options": "DENY", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "cache-control": "no-store",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
});
export type Handler = (body: any) => Promise<Response> | Response;
export function createRouter(port: number, reads: Record<string, Handler>, writes: Record<string, Handler>, upgrade: (req: Request, server: any) => boolean) {
  const dispatch = async (req: Request, server: any): Promise<Response | undefined> => {
    let response: Response;
    try {
      if (!hostAllowed(req.headers, port) || !socketAllowed(req.headers, port)) throw new RequestError("Forbidden host or origin", 403);
      const path = new URL(req.url).pathname;
      if (path === "/ws") {
        if (req.method !== "GET") throw new RequestError("Method not allowed", 405);
        if (upgrade(req, server)) return;
        throw new RequestError("WebSocket unavailable", 503);
      }
      if (req.method === "GET" && Object.hasOwn(reads, path)) response = await reads[path](undefined);
      else if (req.method === "POST" && Object.hasOwn(writes, path)) {
        const guard = mutationAllowed(req.headers, port);
        if (!guard.ok) throw new RequestError(guard.why, 403);
        const body = await readBody(req);
        const invalid = validateBody(path, body);
        if (invalid) throw new RequestError(invalid);
        response = await writes[path](body);
      } else throw new RequestError("Not found", 404);
    } catch (error) {
      response = Response.json({ error: error instanceof Error ? error.message : "Request failed" }, { status: error instanceof RequestError ? error.status : 500 });
    }
    for (const [key, value] of Object.entries(securityHeaders(port))) response.headers.set(key, value);
    return response;
  };
  let active = 0;
  return async (req: Request, server: any): Promise<Response | undefined> => {
    if (active >= 16) return Response.json({ error: "Controller busy" }, { status: 503, headers: securityHeaders(port) });
    active++;
    try { return await dispatch(req, server); } finally { active--; }
  };
}
