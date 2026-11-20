import type { Env } from "../env.ts";

/** Preserve original evidence URLs; credentials and write requests never reach the archive. */
export async function legacyEvidence(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/legacy-api/") || url.pathname === "/api/forum/threads" || url.pathname.startsWith("/api/forum/threads/")) {
    if (!["GET", "HEAD"].includes(request.method)) return Response.json({ error: "Legacy community archive is read-only" }, { status: 405, headers: { Allow: "GET, HEAD" } });
    if (!env.LEGACY_MAP) return Response.json({ error: "Legacy community archive is not connected" }, { status: 503 });
    const target = new URL(url);
    if (url.pathname.startsWith("/legacy-api/")) target.pathname = "/api/" + url.pathname.slice(12);
    const result = await env.LEGACY_MAP.fetch(new Request(target, { method: request.method, headers: { accept: "application/json" }, redirect: "manual" }));
    const headers = new Headers(result.headers); headers.delete("set-cookie");
    return new Response(request.method === "HEAD" ? null : result.body, { status: result.status, headers });
  }
  let path: string | null = null;
  if (url.pathname === "/civic-api" || url.pathname.startsWith("/civic-api/")) path = "/api" + (url.pathname.slice(10) || "/");
  if (url.pathname.startsWith("/civic-files/documents/")) path = url.pathname.slice(12);
  if (url.pathname.startsWith("/documents/")) path = url.pathname;
  if (url.pathname.startsWith("/api/archive/")) path = url.pathname;
  if (path === null) return null;
  if (!["GET", "HEAD"].includes(request.method)) return Response.json({ error: "Legacy evidence is read-only" }, { status: 405, headers: { Allow: "GET, HEAD" } });
  if (!env.LEGACY_RECORDS) return Response.json({ error: "Legacy evidence archive is not connected" }, { status: 503 });
  const target = new URL("https://baldwin-minute-watch-v21.otiseduncan.workers.dev");
  target.pathname = path;
  target.search = url.search;
  const headers = new Headers();
  for (const key of ["accept", "range", "if-range", "if-none-match", "if-modified-since"]) {
    const value = request.headers.get(key);
    if (value) headers.set(key, value);
  }
  try {
    const result = await env.LEGACY_RECORDS.fetch(new Request(target, { method: request.method, headers, redirect: "manual" }));
    const responseHeaders = new Headers(result.headers);
    responseHeaders.delete("set-cookie");
    responseHeaders.set("x-content-type-options", "nosniff");
    return new Response(request.method === "HEAD" ? null : result.body, { status: result.status, headers: responseHeaders });
  } catch {
    return Response.json({ error: "Legacy evidence archive is temporarily unavailable" }, { status: 502 });
  }
}
