// Integration-test harness: runs the real Worker against the real SQL migrations using node:sqlite
// through a D1-compatible shim, plus an in-memory R2 bucket. No Cloudflare account is touched.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { handleApi } from "../src/index.ts";
import type { Env } from "../src/env.ts";
import { sha256Hex, randomToken } from "../src/lib/crypto.ts";

type Row = Record<string, unknown>;

function normalize(v: unknown): unknown {
  if (v === undefined) throw new Error("D1_TYPE_ERROR: undefined bound");
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Uint8Array) return v;
  return v;
}

class Stmt {
  db: DatabaseSync; sql: string; args: unknown[];
  constructor(db: DatabaseSync, sql: string, args: unknown[] = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args: unknown[]) { return new Stmt(this.db, this.sql, args.map(normalize)); }
  async all<T = Row>() { return { results: this.db.prepare(this.sql).all(...(this.args as never[])) as T[], success: true, meta: {} }; }
  async first<T = Row>(col?: string) {
    const row = this.db.prepare(this.sql).get(...(this.args as never[])) as Row | undefined;
    if (!row) return null;
    return (col ? row[col] : { ...row }) as T;
  }
  async run() {
    const r = this.db.prepare(this.sql).run(...(this.args as never[]));
    return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
  async raw() { return this.db.prepare(this.sql).all(...(this.args as never[])).map((r) => Object.values(r as Row)); }
}

export class TestD1 {
  db: DatabaseSync;
  constructor() {
    this.db = new DatabaseSync(":memory:");
    this.db.exec("PRAGMA foreign_keys = ON;");
    const dir = join(import.meta.dirname, "..", "migrations");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) this.db.exec(readFileSync(join(dir, f), "utf8"));
  }
  prepare(sql: string) { return new Stmt(this.db, sql); }
  async batch(stmts: Stmt[]) {
    this.db.exec("BEGIN");
    try {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  async exec(sql: string) { this.db.exec(sql); return { count: 0, duration: 0 }; }
}

export class TestR2 {
  objects = new Map<string, { bytes: Uint8Array; contentType?: string; custom?: Record<string, string> }>();
  async put(key: string, value: Uint8Array | ArrayBuffer, opts?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    this.objects.set(key, { bytes: bytes.slice(), contentType: opts?.httpMetadata?.contentType, custom: opts?.customMetadata });
    return { key };
  }
  async get(key: string) {
    const o = this.objects.get(key);
    if (!o) return null;
    return { body: new Blob([o.bytes as BlobPart]).stream(), arrayBuffer: async () => o.bytes.slice().buffer, httpMetadata: { contentType: o.contentType } };
  }
  async delete(key: string) { this.objects.delete(key); }
}

export interface TestApp {
  env: Env;
  d1: TestD1;
  r2: TestR2;
  call: (method: string, path: string, opts?: { body?: unknown; user?: TestUser; form?: FormData; headers?: Record<string, string> }) => Promise<{ status: number; body: any; headers: Headers }>;
  user: (role?: string, name?: string) => Promise<TestUser>;
}

export interface TestUser { id: string; cookie: string; csrf: string; role: string }

export const ORIGIN = "https://forge.test";

export function createApp(envOverrides: Partial<Env> = {}): TestApp {
  const d1 = new TestD1();
  const r2 = new TestR2();
  const env = { ASSETS: { fetch: async () => new Response("asset") }, DB: d1, DOCS: r2, APP_ENV: "test", ...envOverrides } as unknown as Env;
  let n = 0;
  return {
    env, d1, r2,
    async user(role = "member", name?: string) {
      n++;
      const id = `user-${role}-${n}`;
      const at = new Date().toISOString();
      d1.db.prepare("INSERT INTO users(id,email,google_subject,display_name,role,state,email_verified,created_at) VALUES (?,?,?,?,?,'active',1,?)")
        .run(id, `${id}@example.test`, `sub-${id}`, name || `Test ${role} ${n}`, role, at);
      const token = randomToken(32);
      const csrf = randomToken(24);
      d1.db.prepare("INSERT INTO sessions(id,user_id,csrf_token,created_at,last_seen_at,expires_at) VALUES (?,?,?,?,?,?)")
        .run(await sha256Hex(token), id, csrf, at, at, new Date(Date.now() + 86_400_000).toISOString());
      return { id, cookie: `__Host-forge_session=${token}`, csrf, role };
    },
    async call(method, path, opts = {}) {
      const headers: Record<string, string> = { origin: ORIGIN, ...(opts.headers || {}) };
      if (opts.user) { headers.cookie = opts.user.cookie; headers["x-forge-csrf"] = opts.user.csrf; }
      let body: BodyInit | undefined;
      if (opts.form) body = opts.form;
      else if (opts.body !== undefined) { body = JSON.stringify(opts.body); headers["content-type"] = "application/json"; }
      const res = await handleApi(new Request(ORIGIN + path, { method, headers, body }), env);
      const type = res.headers.get("content-type") || "";
      const parsed = type.includes("json") ? await res.json() : await res.arrayBuffer();
      return { status: res.status, body: parsed, headers: res.headers };
    },
  };
}

export const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
