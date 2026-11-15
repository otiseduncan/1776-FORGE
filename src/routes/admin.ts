import type { Router } from "../lib/context.ts";
import { HttpError, json, pageParams } from "../lib/http.ts";
import { newId } from "../lib/crypto.ts";
import { ROLES, can, roleChangeError } from "../auth/permissions.ts";
import { cleanQuery, int, likePattern, oneOf, reqStr, str } from "../lib/validate.ts";
import { audit, now } from "../lib/store.ts";

export function registerAdmin(r: Router): void {
  r.get("/api/admin/overview", async (c) => {
    const user = await c.require();
    if (!can(user, "article.draft") && !can(user, "moderate")) throw new HttpError(403, "Workspace access requires a contributor role or higher");
    const counts = await c.db.prepare(
      `SELECT
        (SELECT COUNT(*) FROM documents) AS documents,
        (SELECT COUNT(*) FROM documents WHERE verification_state = 'unreviewed') AS documents_unreviewed,
        (SELECT COUNT(*) FROM documents WHERE original_storage_key IS NULL) AS documents_without_file,
        (SELECT COUNT(*) FROM documents WHERE integrity_state = 'mismatch' OR integrity_state = 'missing') AS integrity_failures,
        (SELECT COUNT(*) FROM articles WHERE status = 'review') AS articles_in_review,
        (SELECT COUNT(*) FROM articles WHERE status = 'draft') AS articles_draft,
        (SELECT COUNT(*) FROM articles WHERE status = 'published') AS articles_published,
        (SELECT COUNT(*) FROM content_reports WHERE state = 'open') AS open_reports,
        (SELECT COUNT(*) FROM comments WHERE moderation_state = 'pending') + (SELECT COUNT(*) FROM discussions WHERE moderation_state = 'pending') AS pending_posts,
        (SELECT COUNT(*) FROM map_reports WHERE review_state = 'pending') AS pending_map_reports,
        (SELECT COUNT(*) FROM map_features) AS map_features,
        (SELECT COUNT(*) FROM resource_links WHERE status IN ('broken','needs_review')) AS resources_need_attention,
        (SELECT COUNT(*) FROM resource_links WHERE status = 'unverified') AS resources_unverified,
        (SELECT COUNT(*) FROM users WHERE state = 'active') AS members,
        (SELECT COUNT(*) FROM legacy_import_batches) AS import_batches`,
    ).first();
    return json({ counts, capabilities: { moderate: can(user, "moderate"), publish: can(user, "article.publish"), users: can(user, "users.manage"), audit: can(user, "audit.read"), resources: can(user, "resource.write"), records: can(user, "document.create"), verify: can(user, "document.verify") } });
  });

  r.get("/api/admin/users", async (c) => {
    await c.require("users.manage");
    const { page, size, offset } = pageParams(c.url, 50, 200);
    const q = cleanQuery(c.url);
    const role = c.url.searchParams.get("role");
    const where: string[] = [];
    const args: unknown[] = [];
    if (q) { where.push("(display_name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')"); args.push(likePattern(q), likePattern(q)); }
    if (role) { where.push("role = ?"); args.push(role); }
    const rows = await c.db.prepare(`SELECT id, email, display_name, role, state, created_at, last_login_at FROM users ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(...args, size, offset).all();
    return json({ items: rows.results, page, pageSize: size, roles: ROLES });
  });

  r.patch("/api/admin/users/:id", async (c) => {
    const actor = await c.require("users.manage");
    const target = await c.db.prepare("SELECT id, role, state FROM users WHERE id = ?").bind(c.params.id).first<{ id: string; role: string; state: string }>();
    if (!target) throw new HttpError(404, "User not found");
    const b = await c.body();
    const role = oneOf(b, "role", ROLES);
    const state = oneOf(b, "state", ["active", "suspended", "banned"] as const);
    const reason = reqStr(b, "reason", { min: 3, max: 500 });
    if (role && role !== target.role) {
      const err = roleChangeError(actor, target, role);
      if (err) throw new HttpError(403, err);
      if (target.role === "owner") {
        const owners = await c.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND state = 'active'").first<{ n: number }>();
        if ((owners?.n ?? 0) <= 1) throw new HttpError(409, "The last owner cannot be demoted");
      }
    }
    if (state && state !== target.state) {
      if (target.id === actor.id) throw new HttpError(403, "You cannot change your own account state");
      const err = roleChangeError(actor, target, target.role === "owner" ? "owner" : "member");
      if (err && actor.role !== "owner") throw new HttpError(403, "You cannot change the state of an account at or above your level");
    }
    await c.db.prepare("UPDATE users SET role = COALESCE(?, role), state = COALESCE(?, state), updated_at = ? WHERE id = ?").bind(role, state, now(), target.id).run();
    if (state && state !== "active") await c.db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(target.id).run();
    await audit(c, actor.id, "user.access_changed", "user", target.id, { from: { role: target.role, state: target.state }, to: { role, state }, reason });
    return json({ ok: true });
  });

  r.get("/api/admin/audit", async (c) => {
    await c.require("audit.read");
    const { page, size, offset } = pageParams(c.url, 50, 200);
    const subject = c.url.searchParams.get("subject_type");
    const rows = await c.db.prepare(
      `SELECT a.id, a.action, a.subject_type, a.subject_id, a.details_json, a.created_at, u.display_name AS actor, u.role AS actor_role
         FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id ${subject ? "WHERE a.subject_type = ?" : ""} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
    ).bind(...(subject ? [subject, size, offset] : [size, offset])).all();
    return json({ items: rows.results, page, pageSize: size });
  });

  // ---- legacy import ledger (the import itself runs from scripts/legacy with verified manifests)
  r.get("/api/admin/imports", async (c) => {
    await c.require("imports.manage");
    return json({ items: (await c.db.prepare("SELECT * FROM legacy_import_batches ORDER BY created_at DESC").all()).results });
  });

  r.post("/api/admin/imports", async (c) => {
    const user = await c.require("imports.manage");
    const b = await c.body(2_000_000);
    const sha = reqStr(b, "manifest_sha256", { max: 64 });
    if (!/^[a-f0-9]{64}$/.test(sha)) throw new HttpError(422, "manifest_sha256 must be a SHA-256 hex digest");
    const id = newId();
    await c.db.prepare("INSERT INTO legacy_import_batches(id,manifest_sha256,source_description,expected_rows,expected_objects,state,report_json,created_by,created_at) VALUES (?,?,?,?,?,'planned',?,?,?)")
      .bind(id, sha, reqStr(b, "source_description", { max: 500 }), int(b, "expected_rows", { min: 0 }), int(b, "expected_objects", { min: 0 }), str(b, "report_json", { max: 1_000_000 }), user.id, now()).run();
    await audit(c, user.id, "import.batch_registered", "legacy_import", id, { sha });
    return json({ id }, 201);
  });
}
