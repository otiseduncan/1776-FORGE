import type { Ctx } from "./context.ts";
import { HttpError } from "./http.ts";
import { newId } from "./crypto.ts";

export function now(): string {
  return new Date().toISOString();
}

export async function audit(c: Ctx, actorId: string | null, action: string, subjectType: string, subjectId: string | null, details?: unknown): Promise<void> {
  await c.db.prepare("INSERT INTO audit_events(id,actor_id,action,subject_type,subject_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)")
    .bind(newId(), actorId, action, subjectType, subjectId, details === undefined ? null : JSON.stringify(details), now()).run();
}

export async function moderationEvent(c: Ctx, actorId: string, targetType: string, targetId: string, action: string, reason: string | null): Promise<void> {
  await c.db.prepare("INSERT INTO moderation_events(id,actor_id,target_type,target_id,action,reason,created_at) VALUES (?,?,?,?,?,?,?)")
    .bind(newId(), actorId, targetType, targetId, action, reason, now()).run();
}

export async function notify(c: Ctx, userIds: Iterable<string>, kind: string, subjectType: string, subjectId: string, message: string, link: string): Promise<void> {
  const unique = [...new Set(userIds)];
  if (!unique.length) return;
  const stmt = c.db.prepare("INSERT INTO notifications(id,user_id,kind,subject_type,subject_id,message,link,created_at) VALUES (?,?,?,?,?,?,?,?)");
  const at = now();
  await c.db.batch(unique.slice(0, 200).map((u) => stmt.bind(newId(), u, kind, subjectType, subjectId, message.slice(0, 280), link, at)));
}

/** Entity types that can be linked, cited, discussed or reported, mapped to their table and title column. */
export const ENTITY_TABLES = {
  document: { table: "documents", title: "title", link: (id: string) => `/records/${id}` },
  article: { table: "articles", title: "title", link: (_id: string, row?: Record<string, unknown>) => `/news/${row?.slug ?? ""}` },
  map_feature: { table: "map_features", title: "title", link: (id: string) => `/map?feature=${id}` },
  legal: { table: "legal_authorities", title: "title", link: (id: string) => `/law/${id}` },
  meeting: { table: "meetings", title: "title", link: (id: string) => `/government/meetings/${id}` },
  motion: { table: "motions", title: "title", link: (_id: string, row?: Record<string, unknown>) => `/government/meetings/${row?.meeting_id ?? ""}` },
  budget: { table: "budgets", title: "title", link: (id: string) => `/government/budgets/${id}` },
  financial_report: { table: "financial_reports", title: "report_type", link: (_id: string) => `/government/budgets` },
  resource: { table: "resource_links", title: "name", link: (_id: string) => `/resources` },
  discussion: { table: "discussions", title: "title", link: (id: string) => `/community/t/${id}` },
  comment: { table: "comments", title: "body", link: (_id: string, row?: Record<string, unknown>) => `/community/t/${row?.discussion_id ?? ""}` },
  map_report: { table: "map_reports", title: "title", link: (id: string) => `/map?report=${id}` },
  attachment: { table: "attachments", title: "filename", link: (_id: string) => `` },
  jurisdiction: { table: "jurisdictions", title: "name", link: (id: string) => `/jurisdictions/${id}` },
} as const;
export type EntityType = keyof typeof ENTITY_TABLES;
export const ENTITY_TYPES = Object.keys(ENTITY_TABLES) as EntityType[];

export async function entityExists(c: Ctx, type: string, id: string): Promise<Record<string, unknown>> {
  const def = ENTITY_TABLES[type as EntityType];
  if (!def) throw new HttpError(422, `Unknown entity type: ${type}`);
  const row = await c.db.prepare(`SELECT * FROM ${def.table} WHERE id = ?`).bind(id).first<Record<string, unknown>>();
  if (!row) throw new HttpError(404, `${type.replace("_", " ")} not found`);
  return row;
}

/** Resolve a list of {type,id} references to titles and links for display. */
export async function describeEntities(c: Ctx, refs: { type: string; id: string }[]): Promise<Map<string, { title: string; link: string }>> {
  const out = new Map<string, { title: string; link: string }>();
  const byType = new Map<string, string[]>();
  for (const r of refs) {
    if (!ENTITY_TABLES[r.type as EntityType]) continue;
    const list = byType.get(r.type) || [];
    list.push(r.id);
    byType.set(r.type, list);
  }
  for (const [type, ids] of byType) {
    const def = ENTITY_TABLES[type as EntityType];
    const unique = [...new Set(ids)].slice(0, 100);
    const rows = await c.db.prepare(`SELECT * FROM ${def.table} WHERE id IN (${unique.map(() => "?").join(",")})`).bind(...unique).all<Record<string, unknown>>();
    for (const row of rows.results) {
      const title = String(row[def.title] ?? "").slice(0, 160);
      out.set(`${type}:${row.id}`, { title, link: def.link(String(row.id), row) });
    }
  }
  return out;
}

/** Related content in both directions for one entity. */
export async function relatedContent(c: Ctx, type: string, id: string) {
  const rows = await c.db.prepare(
    `SELECT id, source_type, source_id, target_type, target_id, relationship FROM content_links
      WHERE (source_type = ? AND source_id = ?) OR (target_type = ? AND target_id = ?) LIMIT 200`,
  ).bind(type, id, type, id).all<Record<string, string>>();
  const refs = rows.results.map((r) => (r.source_type === type && r.source_id === id ? { type: r.target_type, id: r.target_id } : { type: r.source_type, id: r.source_id }));
  const titles = await describeEntities(c, refs);
  return rows.results.map((r, i) => {
    const ref = refs[i];
    const d = titles.get(`${ref.type}:${ref.id}`);
    return d ? { link_id: r.id, type: ref.type, id: ref.id, relationship: r.relationship, direction: r.source_id === id && r.source_type === type ? "outgoing" : "incoming", title: d.title, href: d.link } : null;
  }).filter(Boolean);
}

export async function citationsFor(c: Ctx, type: string, id: string) {
  const rows = await c.db.prepare(
    `SELECT ci.id, ci.label, ci.url, ci.document_id, ci.pinpoint, ci.note, d.title AS document_title
       FROM citations ci LEFT JOIN documents d ON d.id = ci.document_id
      WHERE ci.subject_type = ? AND ci.subject_id = ? ORDER BY ci.created_at`,
  ).bind(type, id).all();
  return rows.results;
}

export async function discussionsFor(c: Ctx, type: string, id: string) {
  const rows = await c.db.prepare(
    `SELECT d.id, d.title, d.comment_count, d.last_activity_at, d.created_at, u.display_name AS author
       FROM discussions d JOIN users u ON u.id = d.created_by
      WHERE d.context_type = ? AND d.context_id = ? AND d.moderation_state = 'visible'
      ORDER BY d.last_activity_at DESC LIMIT 20`,
  ).bind(type, id).all();
  return rows.results;
}

export async function verifyTurnstile(c: Ctx, token: unknown): Promise<void> {
  const secret = c.env.TURNSTILE_SECRET_KEY;
  if (!secret) return; // Not configured: documented in docs/IMPLEMENTATION_STATUS.md.
  if (typeof token !== "string" || !token || token.length > 4096) throw new HttpError(422, "Please complete the anti-spam check");
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  const ip = c.req.headers.get("cf-connecting-ip");
  if (ip) form.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const data = (await res.json().catch(() => ({}))) as { success?: boolean };
  if (!data.success) throw new HttpError(422, "Anti-spam check failed. Please try again.");
}

/** Per-account posting limits for community content. */
export async function enforcePostingLimits(c: Ctx, userId: string, body: string): Promise<{ needsReview: boolean }> {
  const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
  const hourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
  const recent = await c.db.prepare(
    `SELECT (SELECT COUNT(*) FROM comments WHERE author_id = ?1 AND created_at > ?2) +
            (SELECT COUNT(*) FROM discussions WHERE created_by = ?1 AND created_at > ?2) AS n,
            (SELECT COUNT(*) FROM comments WHERE author_id = ?1 AND body = ?3 AND created_at > ?4) AS dup`,
  ).bind(userId, tenMinAgo, body, hourAgo).first<{ n: number; dup: number }>();
  if ((recent?.n ?? 0) >= 10) throw new HttpError(429, "You are posting too quickly. Please wait a few minutes.");
  if ((recent?.dup ?? 0) > 0) throw new HttpError(409, "You already posted this exact message recently.");
  const links = (body.match(/https?:\/\//gi) || []).length;
  return { needsReview: links > 4 };
}
