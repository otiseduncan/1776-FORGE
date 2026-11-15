// API client. Adds the CSRF header to unsafe requests and normalises errors.
let csrfToken = null;
export function setCsrf(token) { csrfToken = token || null; }

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function api(path, opts = {}) {
  const method = (opts.method || "GET").toUpperCase();
  const headers = { accept: "application/json", ...(opts.headers || {}) };
  let body = opts.body;
  if (body !== undefined && !(body instanceof FormData)) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(body);
  }
  if (method !== "GET" && csrfToken) headers["x-forge-csrf"] = csrfToken;
  let res;
  try {
    res = await fetch(path, { method, headers, body, credentials: "same-origin", signal: opts.signal });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new ApiError(0, "Network error — check your connection and try again.");
  }
  const type = res.headers.get("content-type") || "";
  const data = type.includes("json") ? await res.json().catch(() => ({})) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error || `Request failed (${res.status})`, data?.details);
  return data;
}

export const get = (path, opts) => api(path, opts);
export const post = (path, body, opts = {}) => api(path, { ...opts, method: "POST", body: body ?? {} });
export const patch = (path, body) => api(path, { method: "PATCH", body });
export const del = (path) => api(path, { method: "DELETE" });

export function qs(params) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  const out = s.toString();
  return out ? "?" + out : "";
}
