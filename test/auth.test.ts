import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createApp, ORIGIN } from "./harness.ts";
import { base64url } from "../src/lib/crypto.ts";
import { resetJwksCache, GOOGLE_JWKS_URL, GOOGLE_TOKEN_URL } from "../src/auth/oidc.ts";
import { roleChangeError, can } from "../src/auth/permissions.ts";

const CLIENT_ID = "test-client.apps.googleusercontent.com";

async function makeKey() {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey) as JsonWebKey;
  return { pair, jwk: { ...jwk, kid: "test-kid", alg: "RS256", use: "sig" } };
}

async function signJwt(key: CryptoKey, claims: Record<string, unknown>, kid = "test-kid") {
  const enc = (o: unknown) => base64url(new TextEncoder().encode(JSON.stringify(o)));
  const head = enc({ alg: "RS256", kid, typ: "JWT" });
  const body = enc(claims);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${base64url(sig)}`;
}

describe("Google OpenID Connect sign-in", () => {
  const realFetch = globalThis.fetch;
  let key: Awaited<ReturnType<typeof makeKey>>;
  let nextClaims: (nonce: string) => Record<string, unknown>;
  let tokenRequests: URLSearchParams[] = [];

  beforeEach(async () => {
    resetJwksCache();
    key = await makeKey();
    tokenRequests = [];
    nextClaims = (nonce) => ({ iss: "https://accounts.google.com", aud: CLIENT_ID, sub: "google-sub-1", email: "Reader@Example.com", email_verified: true, name: "Pat Reader", nonce, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600 });
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === GOOGLE_JWKS_URL) return new Response(JSON.stringify({ keys: [key.jwk] }), { headers: { "cache-control": "max-age=60" } });
      if (url === GOOGLE_TOKEN_URL) {
        const params = new URLSearchParams(String(init?.body));
        tokenRequests.push(params);
        const nonce = pendingNonce;
        return new Response(JSON.stringify({ id_token: await signJwt(key.pair.privateKey, nextClaims(nonce)) }), { headers: { "content-type": "application/json" } });
      }
      throw new Error("unexpected fetch " + url);
    }) as typeof fetch;
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  let pendingNonce = "";

  async function startFlow(app: ReturnType<typeof createApp>) {
    const res = await app.call("GET", "/api/auth/google/start?return=/community");
    assert.equal(res.status, 302);
    const loc = new URL(res.headers.get("location")!);
    assert.equal(loc.origin + loc.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(loc.searchParams.get("code_challenge_method"), "S256");
    assert.equal(loc.searchParams.get("redirect_uri"), `${ORIGIN}/api/auth/google/callback`);
    assert.equal(loc.searchParams.get("scope"), "openid email profile");
    const state = loc.searchParams.get("state")!;
    pendingNonce = loc.searchParams.get("nonce")!;
    const setCookie = res.headers.get("set-cookie")!;
    assert.match(setCookie, /__Host-forge_oauth=/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /Secure/);
    return { state, oauthCookie: `__Host-forge_oauth=${state}` };
  }

  test("reports not configured without Google credentials", async () => {
    const app = createApp();
    const res = await app.call("GET", "/api/auth/google/start");
    assert.equal(res.status, 503);
    const cfg = await app.call("GET", "/api/config");
    assert.equal(cfg.body.authConfigured, false);
    assert.equal(cfg.body.payments, false);
  });

  test("full authorization-code + PKCE flow creates a member and a secure session", async () => {
    const app = createApp({ GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: "secret" });
    const { state, oauthCookie } = await startFlow(app);
    const cb = await app.call("GET", `/api/auth/google/callback?state=${state}&code=abc`, { headers: { cookie: oauthCookie } });
    assert.equal(cb.status, 302);
    assert.equal(cb.headers.get("location"), "/account?welcome=1");
    assert.ok(tokenRequests[0].get("code_verifier")!.length >= 43, "PKCE verifier sent to token endpoint");
    const cookies = cb.headers.getSetCookie();
    const session = cookies.find((c) => c.startsWith("__Host-forge_session="))!;
    assert.match(session, /HttpOnly/); assert.match(session, /Secure/); assert.match(session, /SameSite=Lax/);
    const me = await app.call("GET", "/api/me", { headers: { cookie: session.split(";")[0] } });
    assert.equal(me.body.user.display_name, "Pat Reader");
    assert.equal(me.body.user.role, "member");
    assert.equal(me.body.user.email, "reader@example.com");
    assert.ok(me.body.csrfToken);
    assert.ok(me.body.capabilities.includes("community.post"));
    assert.ok(!me.body.capabilities.includes("moderate"));
    // Raw session token is never stored.
    const stored = app.d1.db.prepare("SELECT id FROM sessions").all() as { id: string }[];
    assert.ok(stored.every((s) => !session.includes(s.id)));
  });

  test("state reuse and state/cookie mismatch are rejected", async () => {
    const app = createApp({ GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: "secret" });
    const { state, oauthCookie } = await startFlow(app);
    const wrong = await app.call("GET", `/api/auth/google/callback?state=${state}&code=abc`, { headers: { cookie: "__Host-forge_oauth=other" } });
    assert.match(wrong.headers.get("location")!, /error=state/);
    const ok = await app.call("GET", `/api/auth/google/callback?state=${state}&code=abc`, { headers: { cookie: oauthCookie } });
    assert.doesNotMatch(ok.headers.get("location")!, /error/);
    const replay = await app.call("GET", `/api/auth/google/callback?state=${state}&code=abc`, { headers: { cookie: oauthCookie } });
    assert.match(replay.headers.get("location")!, /error=expired/);
  });

  for (const [label, mutate, reason] of [
    ["wrong audience", (c: Record<string, unknown>) => ({ ...c, aud: "someone-else" }), "verification"],
    ["wrong issuer", (c: Record<string, unknown>) => ({ ...c, iss: "https://evil.example" }), "verification"],
    ["expired token", (c: Record<string, unknown>) => ({ ...c, exp: Math.floor(Date.now() / 1000) - 3600 }), "verification"],
    ["nonce mismatch", (c: Record<string, unknown>) => ({ ...c, nonce: "forged" }), "verification"],
    ["unverified email", (c: Record<string, unknown>) => ({ ...c, email_verified: false }), "unverified"],
  ] as const) {
    test(`rejects ${label}`, async () => {
      const app = createApp({ GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: "secret" });
      const base = nextClaims;
      nextClaims = (nonce) => mutate(base(nonce));
      const { state, oauthCookie } = await startFlow(app);
      const cb = await app.call("GET", `/api/auth/google/callback?state=${state}&code=abc`, { headers: { cookie: oauthCookie } });
      assert.match(cb.headers.get("location")!, new RegExp(`error=${reason}`));
      assert.equal((app.d1.db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n, 0);
    });
  }

  test("rejects a token signed by an unknown key", async () => {
    const app = createApp({ GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: "secret" });
    const rogue = await makeKey();
    const realSign = key.pair.privateKey;
    key.pair = { ...key.pair, privateKey: rogue.pair.privateKey };
    const { state, oauthCookie } = await startFlow(app);
    const cb = await app.call("GET", `/api/auth/google/callback?state=${state}&code=abc`, { headers: { cookie: oauthCookie } });
    assert.match(cb.headers.get("location")!, /error=verification/);
    key.pair = { ...key.pair, privateKey: realSign };
  });

  test("OWNER_EMAILS bootstraps the owner role from a verified Google identity", async () => {
    const app = createApp({ GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: "secret", OWNER_EMAILS: "reader@example.com" });
    const { state, oauthCookie } = await startFlow(app);
    await app.call("GET", `/api/auth/google/callback?state=${state}&code=abc`, { headers: { cookie: oauthCookie } });
    assert.equal((app.d1.db.prepare("SELECT role FROM users").get() as { role: string }).role, "owner");
  });

  test("open redirect via return parameter is neutralised", async () => {
    const app = createApp({ GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: "secret" });
    await app.call("GET", "/api/auth/google/start?return=//evil.example/x");
    const row = app.d1.db.prepare("SELECT return_to FROM oauth_states").get() as { return_to: string };
    assert.equal(row.return_to, "/");
  });
});

describe("sessions, CSRF and account management", () => {
  test("writes require CSRF token and same origin", async () => {
    const app = createApp();
    const u = await app.user("member");
    const noCsrf = await app.call("PATCH", "/api/me", { body: { display_name: "New Name" }, headers: { cookie: u.cookie } });
    assert.equal(noCsrf.status, 403);
    const crossOrigin = await app.call("PATCH", "/api/me", { body: { display_name: "New Name" }, user: u, headers: { origin: "https://evil.example" } });
    assert.equal(crossOrigin.status, 403);
    const ok = await app.call("PATCH", "/api/me", { body: { display_name: "New Name", bio: "Local researcher" }, user: u });
    assert.equal(ok.status, 200);
    const me = await app.call("GET", "/api/me", { user: u });
    assert.equal(me.body.user.display_name, "New Name");
  });

  test("logout destroys the server-side session", async () => {
    const app = createApp();
    const u = await app.user("member");
    assert.equal((await app.call("POST", "/api/auth/logout", { user: u })).status, 200);
    assert.equal((await app.call("GET", "/api/me", { user: u })).body.user, null);
  });

  test("expired sessions are ignored", async () => {
    const app = createApp();
    const u = await app.user("member");
    app.d1.db.prepare("UPDATE sessions SET expires_at = ?").run(new Date(Date.now() - 1000).toISOString());
    assert.equal((await app.call("GET", "/api/me", { user: u })).body.user, null);
  });

  test("account deletion anonymises the profile and ends sessions", async () => {
    const app = createApp();
    const u = await app.user("member");
    assert.equal((await app.call("POST", "/api/me/delete", { user: u, body: { confirm: "nope" } })).status, 422);
    assert.equal((await app.call("POST", "/api/me/delete", { user: u, body: { confirm: "DELETE" } })).status, 200);
    const row = app.d1.db.prepare("SELECT display_name, state, google_subject FROM users WHERE id = ?").get(u.id) as Record<string, unknown>;
    assert.deepEqual({ ...row }, { display_name: "Former member", state: "deleted", google_subject: null });
  });

  test("suspended accounts cannot write", async () => {
    const app = createApp();
    const u = await app.user("member");
    app.d1.db.prepare("UPDATE users SET state='suspended' WHERE id = ?").run(u.id);
    const res = await app.call("POST", "/api/forum/discussions", { user: u, body: { title: "Hello there", body: "Testing a suspended account", category_id: "general" } });
    assert.equal(res.status, 403);
  });
});

describe("role management rules", () => {
  const admin = { id: "a", role: "admin", state: "active", display_name: "", email: "", avatar_url: null } as const;
  test("admins cannot grant admin/owner or modify peers", () => {
    assert.ok(roleChangeError(admin, { id: "b", role: "member" }, "admin"));
    assert.ok(roleChangeError(admin, { id: "b", role: "admin" }, "member"));
    assert.equal(roleChangeError(admin, { id: "b", role: "member" }, "editor"), null);
    assert.ok(roleChangeError(admin, { id: "a", role: "admin" }, "owner"));
  });
  test("capabilities are separated by role", () => {
    assert.ok(can({ role: "member", state: "active" }, "community.post"));
    assert.ok(!can({ role: "contributor", state: "active" }, "moderate"));
    assert.ok(!can({ role: "researcher", state: "active" }, "article.publish"));
    assert.ok(can({ role: "editor", state: "active" }, "moderate"));
    assert.ok(!can({ role: "editor", state: "active" }, "users.manage"));
    assert.ok(!can({ role: "owner", state: "suspended" }, "community.post"));
  });

  test("admin API enforces escalation rules and last-owner protection", async () => {
    const app = createApp();
    const owner = await app.user("owner");
    const adminU = await app.user("admin");
    const member = await app.user("member");
    assert.equal((await app.call("PATCH", `/api/admin/users/${member.id}`, { user: adminU, body: { role: "owner", reason: "test" } })).status, 403);
    assert.equal((await app.call("PATCH", `/api/admin/users/${member.id}`, { user: adminU, body: { role: "editor", reason: "Trusted reviewer" } })).status, 200);
    assert.equal((await app.call("PATCH", `/api/admin/users/${owner.id}`, { user: owner, body: { role: "member", reason: "test" } })).status, 409);
    assert.equal((await app.call("GET", "/api/admin/users", { user: member })).status, 403);
    const audit = await app.call("GET", "/api/admin/audit", { user: owner });
    assert.ok(audit.body.items.some((e: { action: string }) => e.action === "user.access_changed"));
  });
});
