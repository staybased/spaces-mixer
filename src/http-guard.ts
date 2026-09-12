/** Origin + content-type checks for the local control API. */

export function allowedOrigins(port: number): Set<string> {
  return new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
}

/**
 * A browser page from another origin can still fire a POST at 127.0.0.1 (CORS blocks reading the
 * reply, not the side effect). Refuse anything that carries a foreign Origin, and require JSON so a
 * cross-site form/text-plain post is rejected too. Requests with no Origin (curl, the widget's own
 * fetches include one) pass: another local process is the user's own.
 */
export function mutationAllowed(headers: Headers, port: number): { ok: true } | { ok: false; why: string } {
  const origin = headers.get("origin");
  if (origin && !allowedOrigins(port).has(origin)) return { ok: false, why: `origin ${origin} not allowed` };
  const ct = headers.get("content-type") ?? "";
  if (ct.split(";", 1)[0].trim().toLowerCase() !== "application/json") return { ok: false, why: "content-type must be application/json" };
  return { ok: true };
}

export function socketAllowed(headers: Headers, port: number): boolean {
  const origin = headers.get("origin");
  return !origin || allowedOrigins(port).has(origin);
}

/** Reject rebinding authorities on reads, writes and upgrades, including lookalike hostnames. */
export function hostAllowed(headers: Headers, port: number): boolean {
  return headers.get("host") === `127.0.0.1:${port}` || headers.get("host") === `localhost:${port}`;
}
