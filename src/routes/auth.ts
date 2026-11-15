import type { Router } from "../lib/context.ts";
import { Ctx, SESSION_COOKIE, SESSION_TTL_SECONDS } from "../lib/context.ts";
import { HttpError, cookie, json, parseCookies, redirect } from "../lib/http.ts";
import { newId, randomToken, sha256Hex } from "../lib/crypto.ts";
import { authorizationUrl, exchangeCode, pkceChallenge, verifyIdToken } from "../auth/oidc.ts";
import { capabilitiesFor } from "../auth/permissions.ts";
import { str } from "../lib/validate.ts";
import { audit, now } from "../lib/store.ts";

const OAUTH_COOKIE = "__Host-forge_oauth";

function authConfigured(c: Ctx): boolean {
  return !!(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET && c.env.DB);
}

function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\") || value.length > 300) return "/";
  if (value.startsWith("/api/")) return "/";
  return value;
}

export async function createSession(c: Ctx, userId: string): Promise<string> {
  const token = randomToken(32);
  const id = await sha256Hex(token);
  const expires = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await c.db.prepare("INSERT INTO sessions(id,user_id,csrf_token,user_agent,created_at,last_seen_at,expires_at) VALUES (?,?,?,?,?,?,?)")
    .bind(id, userId, randomToken(24), (c.req.headers.get("user-agent") || "").slice(0, 200), now(), now(), expires).run();
  return cookie(SESSION_COOKIE, token, { maxAge: SESSION_TTL_SECONDS });
}

export async function upsertGoogleUser(c: Ctx, claims: { sub: string; email: string; name?: string; picture?: string }): Promise<{ id: string; created: boolean }> {
  const owners = (c.env.OWNER_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const isOwner = owners.includes(claims.email);
  const existing = await c.db.prepare("SELECT id, role, state FROM users WHERE google_subject = ? OR (google_subject IS NULL AND email = ?) ORDER BY google_subject IS NULL LIMIT 1")
    .bind(claims.sub, claims.email).first<{ id: string; role: string; state: string }>();
  const at = now();
  if (existing) {
    if (existing.state === "banned" || existing.state === "deleted") throw new HttpError(403, "This account cannot sign in");
    await c.db.prepare("UPDATE users SET google_subject = ?, email = ?, email_verified = 1, avatar_url = ?, last_login_at = ?, role = CASE WHEN ? THEN 'owner' ELSE role END WHERE id = ?")
      .bind(claims.sub, claims.email, claims.picture ?? null, at, isOwner ? 1 : 0, existing.id).run();
    return { id: existing.id, created: false };
  }
  const id = newId();
  const display = (claims.name || claims.email.split("@")[0]).slice(0, 60);
  await c.db.prepare("INSERT INTO users(id,email,google_subject,display_name,role,state,email_verified,avatar_url,last_login_at,created_at) VALUES (?,?,?,?,?,'active',1,?,?,?)")
    .bind(id, claims.email, claims.sub, display, isOwner ? "owner" : "member", claims.picture ?? null, at, at).run();
  return { id, created: true };
}

export function registerAuth(r: Router): void {
  r.get("/api/config", (c) => json({
    authConfigured: authConfigured(c),
    databaseConfigured: !!c.env.DB,
    storageConfigured: !!c.env.DOCS,
    turnstileSiteKey: c.env.TURNSTILE_SITE_KEY || null,
    environment: c.env.APP_ENV || "development",
    payments: false,
  }));

  r.get("/api/auth/google/start", async (c) => {
    if (!authConfigured(c)) throw new HttpError(503, "Google sign-in is not configured for this environment yet");
    const state = randomToken(24);
    const nonce = randomToken(24);
    const verifier = randomToken(48);
    const returnTo = safeReturnTo(c.url.searchParams.get("return"));
    await c.db.prepare("DELETE FROM oauth_states WHERE expires_at < ?").bind(now()).run();
    await c.db.prepare("INSERT INTO oauth_states(state,code_verifier,nonce,return_to,expires_at) VALUES (?,?,?,?,?)")
      .bind(state, verifier, nonce, returnTo, new Date(Date.now() + 10 * 60_000).toISOString()).run();
    const headers = new Headers();
    headers.append("set-cookie", cookie(OAUTH_COOKIE, state, { maxAge: 600 }));
    return redirect(authorizationUrl({
      clientId: c.env.GOOGLE_CLIENT_ID!,
      redirectUri: `${c.url.origin}/api/auth/google/callback`,
      state, nonce, challenge: await pkceChallenge(verifier),
    }), headers);
  });

  r.get("/api/auth/google/callback", async (c) => {
    if (!authConfigured(c)) throw new HttpError(503, "Google sign-in is not configured for this environment yet");
    const fail = (reason: string) => {
      const h = new Headers();
      h.append("set-cookie", cookie(OAUTH_COOKIE, "", { maxAge: 0 }));
      return redirect(`/signin?error=${encodeURIComponent(reason)}`, h);
    };
    if (c.url.searchParams.get("error")) return fail("cancelled");
    const state = c.url.searchParams.get("state") || "";
    const code = c.url.searchParams.get("code") || "";
    const cookieState = parseCookies(c.req.headers.get("cookie"))[OAUTH_COOKIE];
    if (!state || !code || !cookieState || cookieState !== state) return fail("state");
    const row = await c.db.prepare("SELECT * FROM oauth_states WHERE state = ?").bind(state).first<{ code_verifier: string; nonce: string; return_to: string; expires_at: string }>();
    await c.db.prepare("DELETE FROM oauth_states WHERE state = ?").bind(state).run();
    if (!row || Date.parse(row.expires_at) < Date.now()) return fail("expired");
    let claims;
    try {
      const idToken = await exchangeCode({ code, clientId: c.env.GOOGLE_CLIENT_ID!, clientSecret: c.env.GOOGLE_CLIENT_SECRET!, redirectUri: `${c.url.origin}/api/auth/google/callback`, verifier: row.code_verifier });
      claims = await verifyIdToken(idToken, { clientId: c.env.GOOGLE_CLIENT_ID!, nonce: row.nonce });
    } catch (e) {
      console.warn("Google sign-in failed", e instanceof Error ? e.message : e);
      return fail(e instanceof HttpError && e.status === 403 ? "unverified" : "verification");
    }
    let user;
    try {
      user = await upsertGoogleUser(c, claims);
    } catch (e) {
      if (e instanceof HttpError && e.status === 403) return fail("blocked");
      throw e;
    }
    const headers = new Headers();
    headers.append("set-cookie", cookie(OAUTH_COOKIE, "", { maxAge: 0 }));
    headers.append("set-cookie", await createSession(c, user.id));
    await audit(c, user.id, user.created ? "user.registered" : "user.signed_in", "user", user.id);
    return redirect(user.created ? "/account?welcome=1" : row.return_to, headers);
  });

  r.post("/api/auth/logout", async (c) => {
    const s = await c.session();
    const headers = new Headers({ "set-cookie": cookie(SESSION_COOKIE, "", { maxAge: 0 }) });
    if (s) {
      c.assertCsrf(s);
      await c.db.prepare("DELETE FROM sessions WHERE id = ?").bind(s.sessionId).run();
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...Object.fromEntries(headers), "content-type": "application/json", "cache-control": "no-store" } });
  });

  r.get("/api/me", async (c) => {
    const s = await c.session();
    if (!s) return json({ user: null, capabilities: [] });
    const unread = await c.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL").bind(s.user.id).first<{ n: number }>();
    const profile = await c.db.prepare("SELECT bio, created_at FROM users WHERE id = ?").bind(s.user.id).first<{ bio: string | null; created_at: string }>();
    return json({
      user: { ...s.user, bio: profile?.bio ?? null, created_at: profile?.created_at },
      csrfToken: s.csrfToken,
      capabilities: capabilitiesFor(s.user),
      unreadNotifications: unread?.n ?? 0,
      entitlements: [],
    });
  });

  r.patch("/api/me", async (c) => {
    const user = await c.require();
    const body = await c.body();
    const display = str(body, "display_name", { min: 2, max: 60 });
    const bio = str(body, "bio", { max: 600 });
    if (display && /[<>]/.test(display)) throw new HttpError(422, "Display name contains unsupported characters");
    await c.db.prepare("UPDATE users SET display_name = COALESCE(?, display_name), bio = ?, updated_at = ? WHERE id = ?")
      .bind(display, bio, now(), user.id).run();
    await audit(c, user.id, "user.profile_updated", "user", user.id);
    return json({ ok: true });
  });

  r.post("/api/me/sessions/revoke-all", async (c) => {
    const user = await c.require();
    await c.db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id).run();
    return json({ ok: true }, 200, { "set-cookie": cookie(SESSION_COOKIE, "", { maxAge: 0 }) });
  });

  r.post("/api/me/delete", async (c) => {
    const user = await c.require();
    const body = await c.body();
    if (body.confirm !== "DELETE") throw new HttpError(422, "Type DELETE to confirm account deletion");
    if (user.role === "owner") {
      const owners = await c.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND state = 'active'").first<{ n: number }>();
      if ((owners?.n ?? 0) <= 1) throw new HttpError(409, "Transfer ownership before deleting the last owner account");
    }
    await c.db.batch([
      c.db.prepare("UPDATE users SET email = ?, google_subject = NULL, display_name = 'Former member', bio = NULL, avatar_url = NULL, state = 'deleted', role = 'member', updated_at = ? WHERE id = ?")
        .bind(`deleted-${user.id}@invalid.local`, now(), user.id),
      c.db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
      c.db.prepare("DELETE FROM follows WHERE user_id = ?").bind(user.id),
      c.db.prepare("DELETE FROM notifications WHERE user_id = ?").bind(user.id),
    ]);
    await audit(c, user.id, "user.deleted_account", "user", user.id);
    return json({ ok: true }, 200, { "set-cookie": cookie(SESSION_COOKIE, "", { maxAge: 0 }) });
  });
}
