import type { Env } from "../env.ts";
import { HttpError, parseCookies, readJson } from "./http.ts";
import { can, type Capability, type SessionUser } from "../auth/permissions.ts";
import { safeEqual, sha256Hex } from "./crypto.ts";

export const SESSION_COOKIE = "__Host-forge_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export interface SessionInfo {
  sessionId: string;
  csrfToken: string;
  user: SessionUser;
}

export class Ctx {
  req: Request;
  env: Env;
  url: URL;
  params: Record<string, string> = {};
  exec?: ExecutionContext;
  private sessionPromise?: Promise<SessionInfo | null>;

  constructor(req: Request, env: Env, exec?: ExecutionContext) {
    this.req = req;
    this.env = env;
    this.url = new URL(req.url);
    this.exec = exec;
  }

  get db(): D1Database {
    if (!this.env.DB) throw new HttpError(503, "The new 1776 FORGE D1 database is not configured in this environment");
    return this.env.DB;
  }

  get bucket(): R2Bucket {
    if (!this.env.DOCS) throw new HttpError(503, "The new 1776 FORGE R2 bucket is not configured in this environment");
    return this.env.DOCS;
  }

  session(): Promise<SessionInfo | null> {
    if (!this.sessionPromise) this.sessionPromise = this.loadSession();
    return this.sessionPromise;
  }

  async user(): Promise<SessionUser | null> {
    return (await this.session())?.user ?? null;
  }

  private async loadSession(): Promise<SessionInfo | null> {
    if (!this.env.DB) return null;
    const token = parseCookies(this.req.headers.get("cookie"))[SESSION_COOKIE];
    if (!token || token.length < 20 || token.length > 100) return null;
    const id = await sha256Hex(token);
    const row = await this.env.DB.prepare(
      `SELECT s.id AS session_id, s.csrf_token, s.expires_at, s.last_seen_at, u.id, u.display_name, u.role, u.state, u.email, u.avatar_url
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    ).bind(id).first<Record<string, string>>();
    if (!row) return null;
    if (Date.parse(row.expires_at) <= Date.now() || row.state === "deleted") {
      await this.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
      return null;
    }
    // Refresh last_seen at most every 10 minutes to limit write volume.
    if (!row.last_seen_at || Date.now() - Date.parse(row.last_seen_at) > 600_000) {
      const p = this.env.DB.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").bind(new Date().toISOString(), id).run();
      if (this.exec) this.exec.waitUntil(p); else await p;
    }
    return {
      sessionId: id,
      csrfToken: row.csrf_token,
      user: { id: row.id, display_name: row.display_name, role: row.role as SessionUser["role"], state: row.state, email: row.email, avatar_url: row.avatar_url },
    };
  }

  /** Require a signed-in, active account with the capability. Unsafe methods also require CSRF proof. */
  async require(cap?: Capability): Promise<SessionUser> {
    const s = await this.session();
    if (!s) throw new HttpError(401, "Sign in with a free FORGE account to continue");
    if (s.user.state !== "active") throw new HttpError(403, "This account is not active");
    if (cap && !can(s.user, cap)) throw new HttpError(403, "Your account does not have permission for this action");
    this.assertCsrf(s);
    return s.user;
  }

  assertCsrf(s: SessionInfo): void {
    const method = this.req.method.toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
    const origin = this.req.headers.get("origin");
    if (origin && origin !== this.url.origin) throw new HttpError(403, "Cross-origin request rejected");
    const fetchSite = this.req.headers.get("sec-fetch-site");
    if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") throw new HttpError(403, "Cross-site request rejected");
    const header = this.req.headers.get("x-forge-csrf") || "";
    if (!header || !safeEqual(header, s.csrfToken)) throw new HttpError(403, "Missing or invalid CSRF token");
  }

  body(maxBytes?: number): Promise<Record<string, unknown>> {
    return readJson(this.req, maxBytes);
  }

  defer(p: Promise<unknown>): void {
    if (this.exec) this.exec.waitUntil(p.catch((e) => console.error("deferred task failed", e)));
    else p.catch((e) => console.error("deferred task failed", e));
  }
}

export type Handler = (c: Ctx) => Promise<Response> | Response;

interface Route { method: string; re: RegExp; keys: string[]; handler: Handler }

export class Router {
  private routes: Route[] = [];

  on(method: string, path: string, handler: Handler): this {
    const keys: string[] = [];
    const re = new RegExp("^" + path.replace(/:([a-zA-Z_]+)/g, (_m, k: string) => { keys.push(k); return "([^/]+)"; }) + "/?$");
    this.routes.push({ method, re, keys, handler });
    return this;
  }
  get(p: string, h: Handler) { return this.on("GET", p, h); }
  post(p: string, h: Handler) { return this.on("POST", p, h); }
  patch(p: string, h: Handler) { return this.on("PATCH", p, h); }
  delete(p: string, h: Handler) { return this.on("DELETE", p, h); }

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | { allowed: string[] } | null {
    const allowed: string[] = [];
    for (const r of this.routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      if (r.method !== method && !(method === "HEAD" && r.method === "GET")) { allowed.push(r.method); continue; }
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { handler: r.handler, params };
    }
    return allowed.length ? { allowed } : null;
  }
}
