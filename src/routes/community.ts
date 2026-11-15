import type { Router, Ctx } from "../lib/context.ts";
import { HttpError, json, pageParams } from "../lib/http.ts";
import { newId } from "../lib/crypto.ts";
import { can } from "../auth/permissions.ts";
import { cleanQuery, likePattern, oneOf, reqStr, str } from "../lib/validate.ts";
import { audit, describeEntities, enforcePostingLimits, entityExists, moderationEvent, notify, now, verifyTurnstile } from "../lib/store.ts";

export const CONTEXT_TYPES = ["forum", "article", "document", "map_feature", "map_report", "legal", "meeting", "budget"] as const;
const REPORTABLE = ["discussion", "comment", "map_report", "attachment"] as const;
const REPORT_REASONS = ["spam", "harassment", "threat", "personal_information", "misinformation", "off_topic", "illegal", "other"] as const;
const FOLLOWABLE = ["discussion", "article", "document", "map_feature", "legal"] as const;
const MAX_DEPTH = 6;

async function loadDiscussion(c: Ctx, id: string) {
  const d = await c.db.prepare(
    `SELECT d.*, u.display_name AS author, u.role AS author_role, fc.name AS category_name
       FROM discussions d JOIN users u ON u.id = d.created_by LEFT JOIN forum_categories fc ON fc.id = d.category_id WHERE d.id = ?`,
  ).bind(id).first<Record<string, unknown>>();
  if (!d) throw new HttpError(404, "Discussion not found");
  return d;
}

function publicComment(row: Record<string, unknown>, viewerId: string | null, isMod: boolean) {
  const state = String(row.moderation_state);
  const visible = state === "visible" || (state === "pending" && (isMod || row.author_id === viewerId));
  return {
    id: row.id,
    parent_id: row.parent_id,
    author: state === "deleted" ? null : { id: row.author_id, display_name: row.author, role: row.author_role },
    body: visible ? row.body : null,
    moderation_state: state,
    removal_reason: state === "hidden" ? row.removal_reason ?? null : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    is_own: !!viewerId && row.author_id === viewerId,
  };
}

export function registerCommunity(r: Router): void {
  r.get("/api/forum/categories", async (c) => {
    const rows = await c.db.prepare(
      `SELECT fc.id, fc.name, fc.description,
        (SELECT COUNT(*) FROM discussions d WHERE d.category_id = fc.id AND d.moderation_state = 'visible') AS discussions,
        (SELECT MAX(d.last_activity_at) FROM discussions d WHERE d.category_id = fc.id AND d.moderation_state = 'visible') AS last_activity_at
       FROM forum_categories fc ORDER BY fc.sort_order`,
    ).all();
    return json({ items: rows.results });
  });

  r.get("/api/forum/discussions", async (c) => {
    const { page, size, offset } = pageParams(c.url, 20, 50);
    const where = ["d.moderation_state = 'visible'"];
    const args: unknown[] = [];
    const cat = c.url.searchParams.get("category");
    if (cat) { where.push("d.category_id = ?"); args.push(cat); }
    const ctxType = c.url.searchParams.get("context_type");
    const ctxId = c.url.searchParams.get("context_id");
    if (ctxType) { where.push("d.context_type = ?"); args.push(ctxType); }
    if (ctxId) { where.push("d.context_id = ?"); args.push(ctxId); }
    const q = cleanQuery(c.url);
    if (q) { where.push("(d.title LIKE ? ESCAPE '\\' OR d.body LIKE ? ESCAPE '\\')"); args.push(likePattern(q), likePattern(q)); }
    const sort = c.url.searchParams.get("sort") === "new" ? "d.created_at DESC" : "d.pinned DESC, d.last_activity_at DESC";
    const w = where.join(" AND ");
    const total = await c.db.prepare(`SELECT COUNT(*) AS n FROM discussions d WHERE ${w}`).bind(...args).first<{ n: number }>();
    const rows = await c.db.prepare(
      `SELECT d.id, d.title, substr(d.body, 1, 280) AS excerpt, d.category_id, fc.name AS category_name, d.context_type, d.context_id,
              d.comment_count, d.pinned, d.locked, d.created_at, d.last_activity_at, u.id AS author_id, u.display_name AS author, u.role AS author_role
         FROM discussions d JOIN users u ON u.id = d.created_by LEFT JOIN forum_categories fc ON fc.id = d.category_id
        WHERE ${w} ORDER BY ${sort} LIMIT ? OFFSET ?`,
    ).bind(...args, size, offset).all<Record<string, string>>();
    const ctx = await describeEntities(c, rows.results.filter((x) => x.context_type !== "forum" && x.context_id).map((x) => ({ type: x.context_type, id: x.context_id })));
    const items = rows.results.map((x) => ({ ...x, context: x.context_id ? ctx.get(`${x.context_type}:${x.context_id}`) ?? null : null }));
    return json({ items, total: total?.n ?? 0, page, pageSize: size });
  });

  r.post("/api/forum/discussions", async (c) => {
    const user = await c.require("community.post");
    const b = await c.body();
    await verifyTurnstile(c, b.turnstileToken);
    const title = reqStr(b, "title", { min: 6, max: 160 });
    const body = reqStr(b, "body", { min: 10, max: 20_000 });
    const contextType = oneOf(b, "context_type", CONTEXT_TYPES, { fallback: "forum" })!;
    const contextId = contextType === "forum" ? null : reqStr(b, "context_id", { max: 80 });
    if (contextId) await entityExists(c, contextType, contextId);
    const category = str(b, "category_id", { max: 40 }) || (contextType === "forum" ? null : "general");
    if (!category) throw new HttpError(422, "Choose a forum category");
    if (!(await c.db.prepare("SELECT 1 FROM forum_categories WHERE id = ?").bind(category).first())) throw new HttpError(422, "Unknown forum category");
    const hourCount = await c.db.prepare("SELECT COUNT(*) AS n FROM discussions WHERE created_by = ? AND created_at > ?").bind(user.id, new Date(Date.now() - 3600_000).toISOString()).first<{ n: number }>();
    if ((hourCount?.n ?? 0) >= 5) throw new HttpError(429, "You can start up to 5 discussions per hour.");
    const { needsReview } = await enforcePostingLimits(c, user.id, body);
    const id = newId();
    const at = now();
    await c.db.batch([
      c.db.prepare(`INSERT INTO discussions(id,jurisdiction_id,context_type,context_id,title,body,category_id,created_by,moderation_state,comment_count,last_activity_at,created_at)
                    VALUES (?,?,?,?,?,?,?,?,?,0,?,?)`).bind(id, str(b, "jurisdiction_id", { max: 80 }), contextType, contextId, title, body, category, user.id, needsReview ? "pending" : "visible", at, at),
      c.db.prepare("INSERT OR IGNORE INTO follows(user_id,target_type,target_id,created_at) VALUES (?,?,?,?)").bind(user.id, "discussion", id, at),
    ]);
    await audit(c, user.id, "discussion.created", "discussion", id, { contextType, contextId });
    return json({ id, moderation_state: needsReview ? "pending" : "visible" }, 201);
  });

  r.get("/api/forum/discussions/:id", async (c) => {
    const user = await c.user();
    const isMod = can(user, "moderate");
    const d = await loadDiscussion(c, c.params.id);
    if (d.moderation_state !== "visible" && !isMod && d.created_by !== user?.id) {
      if (d.moderation_state === "hidden") {
        return json({ discussion: { id: d.id, title: "[Removed by moderators]", moderation_state: "hidden", removal_reason: await removalReason(c, "discussion", c.params.id) }, comments: [], total: 0 });
      }
      throw new HttpError(404, "Discussion not found");
    }
    const { page, size, offset } = pageParams(c.url, 25, 100);
    const total = await c.db.prepare("SELECT COUNT(*) AS n FROM comments WHERE discussion_id = ? AND parent_id IS NULL").bind(c.params.id).first<{ n: number }>();
    // Paginate top-level comments; include their full reply trees (bounded by MAX_DEPTH and a row cap).
    const rows = await c.db.prepare(
      `WITH RECURSIVE top AS (
          SELECT id FROM comments WHERE discussion_id = ?1 AND parent_id IS NULL ORDER BY created_at LIMIT ?2 OFFSET ?3),
        tree(id, depth) AS (
          SELECT id, 0 FROM top
          UNION ALL SELECT c.id, tree.depth + 1 FROM comments c JOIN tree ON c.parent_id = tree.id WHERE tree.depth < ${MAX_DEPTH})
       SELECT c.id, c.parent_id, c.author_id, c.body, c.moderation_state, c.created_at, c.updated_at, u.display_name AS author, u.role AS author_role,
              (SELECT reason FROM moderation_events m WHERE m.target_type='comment' AND m.target_id=c.id AND m.action='hide' ORDER BY m.created_at DESC LIMIT 1) AS removal_reason
         FROM tree JOIN comments c ON c.id = tree.id JOIN users u ON u.id = c.author_id ORDER BY c.created_at LIMIT 1000`,
    ).bind(c.params.id, size, offset).all<Record<string, unknown>>();
    let following = false;
    if (user) following = !!(await c.db.prepare("SELECT 1 FROM follows WHERE user_id = ? AND target_type='discussion' AND target_id = ?").bind(user.id, c.params.id).first());
    const context = d.context_id ? (await describeEntities(c, [{ type: String(d.context_type), id: String(d.context_id) }])).get(`${d.context_type}:${d.context_id}`) ?? null : null;
    const { created_by, ...disc } = d;
    return json({
      discussion: { ...disc, author_id: created_by, context, is_own: user?.id === created_by,
        removal_reason: d.moderation_state === "hidden" ? await removalReason(c, "discussion", c.params.id) : null },
      comments: rows.results.map((row) => publicComment(row, user?.id ?? null, isMod)),
      total: total?.n ?? 0, page, pageSize: size, following,
      permissions: { comment: can(user, "community.post") && !d.locked && d.moderation_state === "visible", moderate: isMod },
    });
  });

  r.post("/api/forum/discussions/:id/comments", async (c) => {
    const user = await c.require("community.post");
    const d = await loadDiscussion(c, c.params.id);
    if (d.moderation_state !== "visible") throw new HttpError(403, "This discussion is not open for comments");
    if (d.locked) throw new HttpError(423, "This discussion has been locked by moderators");
    const b = await c.body();
    await verifyTurnstile(c, b.turnstileToken);
    const body = reqStr(b, "body", { min: 2, max: 10_000 });
    const parentId = str(b, "parent_id", { max: 80 });
    let parentAuthor: string | null = null;
    if (parentId) {
      const parent = await c.db.prepare(
        `WITH RECURSIVE up(id, parent_id, depth) AS (SELECT id, parent_id, 0 FROM comments WHERE id = ?1
           UNION ALL SELECT c.id, c.parent_id, up.depth + 1 FROM comments c JOIN up ON c.id = up.parent_id)
         SELECT (SELECT discussion_id FROM comments WHERE id = ?1) AS discussion_id, (SELECT author_id FROM comments WHERE id = ?1) AS author_id, MAX(depth) AS depth FROM up`,
      ).bind(parentId).first<{ discussion_id: string; author_id: string; depth: number }>();
      if (!parent?.discussion_id || parent.discussion_id !== c.params.id) throw new HttpError(422, "Reply target is not in this discussion");
      if (parent.depth >= MAX_DEPTH - 1) throw new HttpError(422, "Replies are nested as deeply as allowed; reply to an earlier comment instead");
      parentAuthor = parent.author_id;
    }
    const { needsReview } = await enforcePostingLimits(c, user.id, body);
    const id = newId();
    const at = now();
    const state = needsReview ? "pending" : "visible";
    await c.db.batch([
      c.db.prepare("INSERT INTO comments(id,discussion_id,parent_id,author_id,body,moderation_state,created_at) VALUES (?,?,?,?,?,?,?)").bind(id, c.params.id, parentId, user.id, body, state, at),
      c.db.prepare("UPDATE discussions SET comment_count = comment_count + ?, last_activity_at = ? WHERE id = ?").bind(state === "visible" ? 1 : 0, at, c.params.id),
      c.db.prepare("INSERT OR IGNORE INTO follows(user_id,target_type,target_id,created_at) VALUES (?,?,?,?)").bind(user.id, "discussion", c.params.id, at),
    ]);
    if (state === "visible") {
      const followers = await c.db.prepare("SELECT user_id FROM follows WHERE target_type='discussion' AND target_id = ?").bind(c.params.id).all<{ user_id: string }>();
      const recipients = new Set(followers.results.map((f) => f.user_id));
      if (parentAuthor) recipients.add(parentAuthor);
      recipients.delete(user.id);
      await notify(c, recipients, parentAuthor ? "reply" : "comment", "discussion", c.params.id, `${user.display_name} ${parentAuthor ? "replied" : "commented"} in “${String(d.title).slice(0, 80)}”`, `/community/t/${c.params.id}#c-${id}`);
    }
    await audit(c, user.id, "comment.created", "comment", id, { discussion: c.params.id, state });
    return json({ id, moderation_state: state }, 201);
  });

  r.patch("/api/comments/:id", async (c) => {
    const user = await c.require("community.post");
    const row = await c.db.prepare("SELECT author_id, moderation_state, body FROM comments WHERE id = ?").bind(c.params.id).first<Record<string, string>>();
    if (!row) throw new HttpError(404, "Comment not found");
    if (row.author_id !== user.id) throw new HttpError(403, "You can only edit your own comments");
    if (row.moderation_state === "hidden" || row.moderation_state === "deleted") throw new HttpError(409, "This comment can no longer be edited");
    const b = await c.body();
    const body = reqStr(b, "body", { min: 2, max: 10_000 });
    await c.db.prepare("UPDATE comments SET body = ?, updated_at = ? WHERE id = ?").bind(body, now(), c.params.id).run();
    await audit(c, user.id, "comment.edited", "comment", c.params.id, { previous: row.body.slice(0, 2000) });
    return json({ ok: true });
  });

  r.delete("/api/comments/:id", async (c) => {
    const user = await c.require("community.post");
    const row = await c.db.prepare("SELECT author_id, discussion_id, moderation_state FROM comments WHERE id = ?").bind(c.params.id).first<Record<string, string>>();
    if (!row) throw new HttpError(404, "Comment not found");
    if (row.author_id !== user.id) throw new HttpError(403, "You can only delete your own comments");
    await c.db.batch([
      c.db.prepare("UPDATE comments SET moderation_state = 'deleted', body = '', updated_at = ? WHERE id = ?").bind(now(), c.params.id),
      c.db.prepare("UPDATE discussions SET comment_count = MAX(comment_count - ?, 0) WHERE id = ?").bind(row.moderation_state === "visible" ? 1 : 0, row.discussion_id),
    ]);
    await audit(c, user.id, "comment.deleted_by_author", "comment", c.params.id);
    return json({ ok: true });
  });

  // ---- reports, follows, notifications
  r.post("/api/reports", async (c) => {
    const user = await c.require("community.report");
    const b = await c.body();
    const targetType = oneOf(b, "target_type", REPORTABLE, { required: true })!;
    const targetId = reqStr(b, "target_id", { max: 80 });
    await entityExists(c, targetType, targetId);
    const res = await c.db.prepare("INSERT OR IGNORE INTO content_reports(id,reporter_id,target_type,target_id,reason,details,state,created_at) VALUES (?,?,?,?,?,?,'open',?)")
      .bind(newId(), user.id, targetType, targetId, oneOf(b, "reason", REPORT_REASONS, { required: true }), str(b, "details", { max: 2000 }), now()).run();
    if (!res.meta.changes) throw new HttpError(409, "You have already reported this content");
    return json({ ok: true }, 201);
  });

  r.post("/api/follows", async (c) => {
    const user = await c.require("community.post");
    const b = await c.body();
    const type = oneOf(b, "target_type", FOLLOWABLE, { required: true })!;
    const id = reqStr(b, "target_id", { max: 80 });
    await entityExists(c, type, id);
    if (b.follow === false) await c.db.prepare("DELETE FROM follows WHERE user_id = ? AND target_type = ? AND target_id = ?").bind(user.id, type, id).run();
    else await c.db.prepare("INSERT OR IGNORE INTO follows(user_id,target_type,target_id,created_at) VALUES (?,?,?,?)").bind(user.id, type, id, now()).run();
    return json({ following: b.follow !== false });
  });

  r.get("/api/notifications", async (c) => {
    const user = await c.require();
    const rows = await c.db.prepare("SELECT id, kind, message, link, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50").bind(user.id).all();
    return json({ items: rows.results });
  });

  r.post("/api/notifications/read", async (c) => {
    const user = await c.require();
    const b = await c.body();
    const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === "string").slice(0, 100) : null;
    if (ids?.length) await c.db.prepare(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND id IN (${ids.map(() => "?").join(",")})`).bind(now(), user.id, ...ids).run();
    else await c.db.prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL").bind(now(), user.id).run();
    return json({ ok: true });
  });

  // ---- moderation
  r.get("/api/moderation/queue", async (c) => {
    await c.require("moderate");
    const [reports, comments, discussions, mapReports, attachments] = await Promise.all([
      c.db.prepare(`SELECT r.target_type, r.target_id, COUNT(*) AS reports, GROUP_CONCAT(DISTINCT r.reason) AS reasons, MIN(r.created_at) AS first_reported
                      FROM content_reports r WHERE r.state = 'open' GROUP BY r.target_type, r.target_id ORDER BY reports DESC, first_reported LIMIT 100`).all<Record<string, string>>(),
      c.db.prepare("SELECT c.id, c.discussion_id, c.body, c.created_at, u.display_name AS author FROM comments c JOIN users u ON u.id = c.author_id WHERE c.moderation_state = 'pending' ORDER BY c.created_at LIMIT 100").all(),
      c.db.prepare("SELECT d.id, d.title, d.body, d.created_at, u.display_name AS author FROM discussions d JOIN users u ON u.id = d.created_by WHERE d.moderation_state = 'pending' ORDER BY d.created_at LIMIT 100").all(),
      c.db.prepare("SELECT r.id, r.title, r.description, r.category, r.lat, r.lng, r.created_at, u.display_name AS author FROM map_reports r LEFT JOIN users u ON u.id = r.author_id WHERE r.review_state = 'pending' ORDER BY r.created_at LIMIT 100").all(),
      c.db.prepare("SELECT id, owner_type, owner_id, filename, mime_type, size, created_at FROM attachments WHERE moderation_state = 'pending' ORDER BY created_at LIMIT 100").all(),
    ]);
    const described = await describeEntities(c, reports.results.map((x) => ({ type: x.target_type, id: x.target_id })));
    return json({
      reports: reports.results.map((x) => ({ ...x, target: described.get(`${x.target_type}:${x.target_id}`) ?? null })),
      pendingComments: comments.results, pendingDiscussions: discussions.results, pendingMapReports: mapReports.results, pendingAttachments: attachments.results,
    });
  });

  r.post("/api/moderation/actions", async (c) => {
    const user = await c.require("moderate");
    const b = await c.body();
    const targetType = oneOf(b, "target_type", ["discussion", "comment", "attachment"] as const, { required: true })!;
    const targetId = reqStr(b, "target_id", { max: 80 });
    const action = oneOf(b, "action", ["hide", "restore", "approve", "lock", "unlock", "pin", "unpin", "dismiss_reports"] as const, { required: true })!;
    const reason = str(b, "reason", { max: 1000 });
    if ((action === "hide" || action === "lock") && !reason) throw new HttpError(422, "A public reason is required for this moderation action");
    const target = await entityExists(c, targetType, targetId);
    const at = now();
    const stmts: D1PreparedStatement[] = [];
    if (targetType === "comment") {
      const prev = String(target.moderation_state);
      if (action === "hide" || action === "restore" || action === "approve") {
        const next = action === "hide" ? "hidden" : "visible";
        const delta = (next === "visible" ? 1 : 0) - (prev === "visible" ? 1 : 0);
        stmts.push(c.db.prepare("UPDATE comments SET moderation_state = ? WHERE id = ?").bind(next, targetId));
        if (delta) stmts.push(c.db.prepare("UPDATE discussions SET comment_count = MAX(comment_count + ?, 0) WHERE id = ?").bind(delta, target.discussion_id));
      } else if (action !== "dismiss_reports") throw new HttpError(422, "That action does not apply to comments");
    } else if (targetType === "discussion") {
      const map: Record<string, [string, unknown]> = { hide: ["moderation_state", "hidden"], restore: ["moderation_state", "visible"], approve: ["moderation_state", "visible"], lock: ["locked", 1], unlock: ["locked", 0], pin: ["pinned", 1], unpin: ["pinned", 0] };
      if (map[action]) stmts.push(c.db.prepare(`UPDATE discussions SET ${map[action][0]} = ? WHERE id = ?`).bind(map[action][1], targetId));
    } else if (targetType === "attachment") {
      const map: Record<string, string> = { hide: "rejected", approve: "approved", restore: "approved" };
      if (!map[action] && action !== "dismiss_reports") throw new HttpError(422, "That action does not apply to attachments");
      if (map[action]) stmts.push(c.db.prepare("UPDATE attachments SET moderation_state = ? WHERE id = ?").bind(map[action], targetId));
    }
    stmts.push(c.db.prepare("UPDATE content_reports SET state = ?, resolved_by = ?, resolved_at = ? WHERE target_type = ? AND target_id = ? AND state = 'open'")
      .bind(action === "dismiss_reports" ? "dismissed" : "actioned", user.id, at, targetType, targetId));
    await c.db.batch(stmts);
    await moderationEvent(c, user.id, targetType, targetId, action, reason);
    const authorId = String(target.author_id ?? target.created_by ?? target.uploaded_by ?? "");
    if (authorId && (action === "hide" || action === "approve" || action === "restore")) {
      const link = targetType === "comment" ? `/community/t/${target.discussion_id}` : targetType === "discussion" ? `/community/t/${targetId}` : "/account";
      await notify(c, [authorId], "moderation", targetType, targetId, `A moderator ${action === "hide" ? "removed" : "approved"} your ${targetType}.${reason ? " Reason: " + reason : ""}`, link);
    }
    return json({ ok: true });
  });

  /** Public transparency log: what was moderated, when and why. Moderator identities are shown by role only. */
  r.get("/api/moderation/log", async (c) => {
    const { page, size, offset } = pageParams(c.url, 30, 100);
    const rows = await c.db.prepare(
      `SELECT m.id, m.target_type, m.target_id, m.action, m.reason, m.created_at, u.role AS moderator_role
         FROM moderation_events m LEFT JOIN users u ON u.id = m.actor_id ORDER BY m.created_at DESC LIMIT ? OFFSET ?`,
    ).bind(size, offset).all();
    return json({ items: rows.results, page, pageSize: size });
  });
}

async function removalReason(c: Ctx, type: string, id: string): Promise<string | null> {
  const row = await c.db.prepare("SELECT reason FROM moderation_events WHERE target_type = ? AND target_id = ? AND action = 'hide' ORDER BY created_at DESC LIMIT 1").bind(type, id).first<{ reason: string }>();
  return row?.reason ?? null;
}
