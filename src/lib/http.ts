export class HttpError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const baseHeaders: Record<string, string> = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...baseHeaders, ...headers } });
}

export function publicJson(body: unknown, maxAge = 60): Response {
  return json(body, 200, { "cache-control": `public, max-age=${maxAge}` });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return json({ error: err.message, ...(err.details ? { details: err.details } : {}) }, err.status);
  }
  console.error("Unhandled error", err instanceof Error ? err.stack || err.message : err);
  return json({ error: "Internal server error" }, 500);
}

export async function readJson(req: Request, maxBytes = 256_000): Promise<Record<string, unknown>> {
  const type = req.headers.get("content-type") || "";
  if (!type.includes("application/json")) throw new HttpError(415, "Expected application/json body");
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "Request body too large");
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Malformed JSON body");
  }
}

export function pageParams(url: URL, defaultSize = 20, maxSize = 100): { page: number; size: number; offset: number } {
  const page = Math.max(1, Math.min(10_000, parseInt(url.searchParams.get("page") || "1", 10) || 1));
  const size = Math.max(1, Math.min(maxSize, parseInt(url.searchParams.get("pageSize") || String(defaultSize), 10) || defaultSize));
  return { page, size, offset: (page - 1) * size };
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function cookie(name: string, value: string, opts: { maxAge?: number; httpOnly?: boolean; sameSite?: "Lax" | "Strict" } = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "Secure", `SameSite=${opts.sameSite || "Lax"}`];
  if (opts.httpOnly !== false) parts.push("HttpOnly");
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  return parts.join("; ");
}

export function redirect(location: string, headers: Headers = new Headers()): Response {
  headers.set("location", location);
  headers.set("cache-control", "no-store");
  return new Response(null, { status: 302, headers });
}
