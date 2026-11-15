#!/usr/bin/env node
// LOCAL DEVELOPMENT ONLY — creates a test member and session in the *local* Wrangler D1
// (the SQLite file under .wrangler/). It never touches staging, production or legacy data:
// the wrangler command is hard-coded with --local and the script refuses any remote flag.
//
// This is not an authentication path in the application. The Worker still accepts only
// its normal opaque session cookie; this script just inserts one row you can use while
// Google OAuth is not configured locally.
//
// Usage: npm run dev:session -- [role] [display name]
//   role: member | contributor | researcher | editor | admin | owner   (default: editor)
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROLES = ["member", "contributor", "researcher", "editor", "admin", "owner"];
const args = process.argv.slice(2);
if (args.some((a) => a.startsWith("--remote") || a.startsWith("--env"))) {
  console.error("dev-session only writes to the local development database. Refusing.");
  process.exit(1);
}
const role = args[0] || "editor";
if (!ROLES.includes(role)) { console.error(`Unknown role "${role}". Use one of: ${ROLES.join(", ")}`); process.exit(1); }
const name = args.slice(1).join(" ") || `Local ${role[0].toUpperCase()}${role.slice(1)}`;

const userId = randomUUID();
const token = randomBytes(32).toString("base64url");
const sessionId = createHash("sha256").update(token).digest("hex");
const csrf = randomBytes(24).toString("base64url");
const now = new Date().toISOString();
const expires = new Date(Date.now() + 7 * 86400_000).toISOString();
const email = `${role}.${userId.slice(0, 8)}@dev.forge.test`;
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

const sql = [
  `INSERT INTO users(id,email,display_name,role,state,created_at) VALUES (${q(userId)},${q(email)},${q(name)},${q(role)},'active',${q(now)});`,
  `INSERT INTO sessions(id,user_id,csrf_token,user_agent,created_at,last_seen_at,expires_at) VALUES (${q(sessionId)},${q(userId)},${q(csrf)},'dev-session script',${q(now)},${q(now)},${q(expires)});`,
  `INSERT INTO audit_events(id,actor_id,action,subject_type,subject_id,details_json,created_at) VALUES (${q(randomUUID())},${q(userId)},'dev.session_created','user',${q(userId)},'{"local_only":true}',${q(now)});`,
].join("\n");

const dir = join(tmpdir(), "forge-dev-session");
mkdirSync(dir, { recursive: true });
const file = join(dir, `session-${Date.now()}.sql`);
writeFileSync(file, sql);
execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["wrangler", "d1", "execute", "DB", "--local", "--file", file], { stdio: "inherit", shell: process.platform === "win32" });

console.log(`
Local ${role} session created for "${name}" (${email}).
In the browser at http://localhost:8787 open DevTools → Console and run:

  document.cookie = "__Host-forge_session=${token}; Path=/; Secure; SameSite=Lax"

then reload. The session lasts 7 days and exists only in .wrangler/ on this machine.
`);
