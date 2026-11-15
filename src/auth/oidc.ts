import { HttpError } from "../lib/http.ts";
import { base64url, base64urlDecode, sha256Base64url } from "../lib/crypto.ts";

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export interface GoogleClaims {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
  nonce?: string;
}

export async function pkceChallenge(verifier: string): Promise<string> {
  return sha256Base64url(verifier);
}

export function authorizationUrl(opts: { clientId: string; redirectUri: string; state: string; nonce: string; challenge: string }): string {
  const u = new URL(GOOGLE_AUTH_URL);
  u.searchParams.set("client_id", opts.clientId);
  u.searchParams.set("redirect_uri", opts.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "openid email profile");
  u.searchParams.set("state", opts.state);
  u.searchParams.set("nonce", opts.nonce);
  u.searchParams.set("code_challenge", opts.challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("prompt", "select_account");
  return u.toString();
}

export async function exchangeCode(opts: { code: string; clientId: string; clientSecret: string; redirectUri: string; verifier: string }): Promise<string> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: opts.code,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      redirect_uri: opts.redirectUri,
      grant_type: "authorization_code",
      code_verifier: opts.verifier,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (!res.ok || !data.id_token) throw new HttpError(502, "Google sign-in could not be completed");
  return data.id_token;
}

interface Jwk { kid: string; kty: string; n: string; e: string; alg?: string }
let jwksCache: { keys: Jwk[]; expires: number } | null = null;

export function resetJwksCache(): void {
  jwksCache = null;
}

async function googleKeys(forceRefresh = false): Promise<Jwk[]> {
  if (!forceRefresh && jwksCache && jwksCache.expires > Date.now()) return jwksCache.keys;
  const res = await fetch(GOOGLE_JWKS_URL);
  if (!res.ok) throw new HttpError(502, "Unable to fetch Google signing keys");
  const data = (await res.json()) as { keys: Jwk[] };
  const maxAge = /max-age=(\d+)/.exec(res.headers.get("cache-control") || "")?.[1];
  jwksCache = { keys: data.keys || [], expires: Date.now() + Math.min(Number(maxAge || 3600), 86_400) * 1000 };
  return jwksCache.keys;
}

/** Verify a Google ID token: RS256 signature against Google's JWKS, issuer, audience, expiry, nonce, verified email. */
export async function verifyIdToken(idToken: string, opts: { clientId: string; nonce: string; nowMs?: number }): Promise<GoogleClaims> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new HttpError(401, "Malformed identity token");
  let header: { alg?: string; kid?: string };
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(base64urlDecode(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(base64urlDecode(parts[1])));
  } catch {
    throw new HttpError(401, "Malformed identity token");
  }
  if (header.alg !== "RS256" || !header.kid) throw new HttpError(401, "Unsupported identity token algorithm");
  let jwk = (await googleKeys()).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await googleKeys(true)).find((k) => k.kid === header.kid);
  if (!jwk) throw new HttpError(401, "Unknown identity token signing key");
  const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64urlDecode(parts[2]) as BufferSource, new TextEncoder().encode(parts[0] + "." + parts[1]));
  if (!valid) throw new HttpError(401, "Identity token signature is invalid");

  const nowSec = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  const skew = 120;
  if (!GOOGLE_ISSUERS.includes(String(claims.iss))) throw new HttpError(401, "Identity token issuer is invalid");
  const aud = claims.aud;
  if (!(aud === opts.clientId || (Array.isArray(aud) && aud.includes(opts.clientId)))) throw new HttpError(401, "Identity token audience is invalid");
  if (Array.isArray(aud) && aud.length > 1 && claims.azp !== opts.clientId) throw new HttpError(401, "Identity token authorized party is invalid");
  if (typeof claims.exp !== "number" || claims.exp + skew < nowSec) throw new HttpError(401, "Identity token has expired");
  if (typeof claims.iat !== "number" || claims.iat - skew > nowSec) throw new HttpError(401, "Identity token issue time is invalid");
  if (claims.nonce !== opts.nonce) throw new HttpError(401, "Identity token nonce mismatch");
  if (typeof claims.sub !== "string" || !claims.sub) throw new HttpError(401, "Identity token subject missing");
  if (claims.email_verified !== true || typeof claims.email !== "string") throw new HttpError(403, "A verified Google email address is required");
  return {
    sub: claims.sub,
    email: claims.email.toLowerCase(),
    email_verified: true,
    name: typeof claims.name === "string" ? claims.name : undefined,
    picture: typeof claims.picture === "string" ? claims.picture : undefined,
    nonce: String(claims.nonce),
  };
}

export { base64url };
