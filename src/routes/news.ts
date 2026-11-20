import type { Router, Ctx } from "../lib/context.ts";
import { HttpError, json, pageParams } from "../lib/http.ts";
import { newId } from "../lib/crypto.ts";
import { can, roleRank, type SessionUser } from "../auth/permissions.ts";
import { cleanQuery, httpsUrl, int, isoDate, likePattern, oneOf, reqStr, slugify, str, stringList, videoUrl } from "../lib/validate.ts";
import { audit, citationsFor, discussionsFor, notify, now, relatedContent } from "../lib/store.ts";

/**
 * Story types. Stored values are stable; display labels live in the frontend.
 * report = Reporting, commentary = Opinion, explainer = Education.
 */
export const ARTICLE_KINDS = ["investigation", "report", "update", "explainer", "commentary", "community", "personal_essay"] as const;
export const MANUSCRIPT_STATES = ["original", "imported", "needs_manuscript", "needs_evidence"] as const;
const WORDS_SQL = "(LENGTH(TRIM(a.body)) - LENGTH(REPLACE(REPLACE(TRIM(a.body), ' ', ''), char(10), '')) + 1)";

export const LIST_FIELDS = `a.id, a.slug, a.title, a.summary, a.excerpt, a.kind, a.category_id, ac.name AS category_name, a.featured, a.video_url, a.published_at, a.updated_at,
  a.status, a.jurisdiction_id, j.name AS jurisdiction_name, a.byline, a.original_publisher, a.original_published_at, a.manuscript_state,
  a.series_id, s.title AS series_title, s.slug AS series_slug, a.series_order,
  a.hero_media_id, m.alt_text AS hero_alt, m.is_illustration AS hero_is_illustration,
  u.id AS author_id, u.display_name AS author, u.avatar_url AS author_avatar, ${WORDS_SQL} AS word_count,
  (SELECT COUNT(*) FROM article_corrections cr WHERE cr.article_id = a.id) AS corrections,
  (SELECT GROUP_CONCAT(t.name, '|') FROM article_tags at JOIN tags t ON t.id = at.tag_id WHERE at.article_id = a.id) AS tags`;
export const FROM = `FROM articles a LEFT JOIN users u ON u.id = a.author_id LEFT JOIN article_categories ac ON ac.id = a.category_id
  LEFT JOIN jurisdictions j ON j.id = a.jurisdiction_id LEFT JOIN article_series s ON s.id = a.series_id LEFT JOIN media_assets m ON m.id = a.hero_media_id`;

export function readingMinutes(words: number): number {
  return Math.max(1, Math.round(words / 230));
}

export function shape(row: Record<string, unknown>): Record<string, unknown> {
  const words = Number(row.word_count) || 0;
  return {
    ...row,
    tags: row.tags ? String(row.tags).split("|") : [],
    byline: row.byline || row.author || "Baldwin Minute Watch staff",
    reading_minutes: readingMinutes(words),
    hero_url: row.hero_media_id ? `/api/media/${row.hero_media_id}/file` : null,
    hero_is_illustration: !!row.hero_is_illustration,
  };
}

async function setTags(c: Ctx, articleId: string, tags: string[]) {
  const stmts: D1PreparedStatement[] = [c.db.prepare("DELETE FROM article_tags WHERE article_id = ?").bind(articleId)];
  for (const name of tags.slice(0, 12)) {
    const id = slugify(name);
    stmts.push(c.db.prepare("INSERT OR IGNORE INTO tags(id,name) VALUES (?,?)").bind(id, name));
    stmts.push(c.db.prepare("INSERT OR IGNORE INTO article_tags(article_id,tag_id) VALUES (?,?)").bind(articleId, id));
  }
  await c.db.batch(stmts);
}

export async function loadArticle(c: Ctx, idOrSlug: string) {
  const row = await c.db.prepare(`SELECT ${LIST_FIELDS}, a.body, a.access_level, a.current_version, a.review_note, a.created_at, u.bio AS author_bio,
       a.original_headline, a.original_url, a.provenance_note, a.seo_title, a.seo_description, a.keywords, a.legacy_ref,
       m.caption AS hero_caption, m.credit AS hero_credit, m.width AS hero_width, m.height AS hero_height
     ${FROM} WHERE a.id = ? OR a.slug = ?`).bind(idOrSlug, idOrSlug).first<Record<string, unknown>>();
  if (!row) throw new HttpError(404, "Article not found");
  return row;
}

export function canEditArticle(user: SessionUser | null, a: Record<string, unknown>): boolean {
  if (!user) return false;
  if (can(user, "article.publish")) return true;
  return can(user, "article.draft") && a.author_id === user.id && (a.status === "draft" || a.status === "review");
}

/** Readers see published stories. Editors, and authors of their own work, may preview the rest. */
export function canReadArticle(user: SessionUser | null, a: Record<string, unknown>): boolean {
  return a.status === "published" || canEditArticle(user, a) || (!!user && a.author_id === user.id);
}

async function uniqueSlug(c: Ctx, base: string, exceptId?: string): Promise<string> {
  const root = slugify(base) || "story";
  let slug = root;
  for (let i = 2; i < 50; i++) {
    const hit = await c.db.prepare("SELECT id FROM articles WHERE slug = ?").bind(slug).first<{ id: string }>();
    if (!hit || hit.id === exceptId) return slug;
    slug = `${root.slice(0, 72)}-${i}`;
  }
  return `${root.slice(0, 60)}-${newId().slice(0, 8)}`;
}

async function checkRef(c: Ctx, table: string, id: string | null, label: string) {
  if (id && !(await c.db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).bind(id).first())) throw new HttpError(422, `Unknown ${label}`);
}

/** Metadata fields shared by create and update. Only keys present in the body are returned. */
async function metadataFrom(c: Ctx, b: Record<string, unknown>) {
  const m: Record<string, unknown> = {};
  if ("summary" in b) m.summary = str(b, "summary", { max: 600 });
  if ("excerpt" in b) m.excerpt = str(b, "excerpt", { max: 320 });
  if ("kind" in b) m.kind = oneOf(b, "kind", ARTICLE_KINDS, { required: true });
  if ("category_id" in b) { m.category_id = str(b, "category_id", { max: 40 }); await checkRef(c, "article_categories", m.category_id as string | null, "category"); }
  if ("jurisdiction_id" in b) { m.jurisdiction_id = str(b, "jurisdiction_id", { max: 80 }); await checkRef(c, "jurisdictions", m.jurisdiction_id as string | null, "jurisdiction"); }
  if ("video_url" in b) m.video_url = videoUrl(b);
  if ("byline" in b) m.byline = str(b, "byline", { max: 160 });
  if ("original_publisher" in b) m.original_publisher = str(b, "original_publisher", { max: 160 });
  if ("original_published_at" in b) m.original_published_at = isoDate(b, "original_published_at");
  if ("original_headline" in b) m.original_headline = str(b, "original_headline", { max: 300 });
  if ("original_url" in b) m.original_url = httpsUrl(b, "original_url");
  if ("provenance_note" in b) m.provenance_note = str(b, "provenance_note", { max: 4000 });
  if ("seo_title" in b) m.seo_title = str(b, "seo_title", { max: 90 });
  if ("seo_description" in b) m.seo_description = str(b, "seo_description", { max: 300 });
  if ("keywords" in b) m.keywords = stringList(b, "keywords", { maxItems: 20, maxLen: 50 }).join(", ") || null;
  if ("series_id" in b) { m.series_id = str(b, "series_id", { max: 80 }); await checkRef(c, "article_series", m.series_id as string | null, "series"); }
  if ("series_order" in b) m.series_order = int(b, "series_order", { min: 1, max: 500 });
  if ("hero_media_id" in b) { m.hero_media_id = str(b, "hero_media_id", { max: 80 }); await checkRef(c, "media_assets", m.hero_media_id as string | null, "image"); }
  if ("manuscript_state" in b) m.manuscript_state = oneOf(b, "manuscript_state", MANUSCRIPT_STATES, { required: true });
  return m;
}

/** Records attached as evidence/citations, plus citations that point at archived records. */
async function sourceDocuments(c: Ctx, articleId: string, user: SessionUser | null) {
  const staff = can(user, "document.create");
  const rows = await c.db.prepare(
    `SELECT DISTINCT d.id, d.title, d.document_type, d.record_date, d.verification_state, d.original_sha256, d.mime_type, d.source_url, d.visibility,
            j.name AS jurisdiction_name, cl.relationship
       FROM content_links cl JOIN documents d ON d.id = cl.target_id LEFT JOIN jurisdictions j ON j.id = d.jurisdiction_id
      WHERE cl.source_type = 'article' AND cl.source_id = ? AND cl.target_type = 'document'
      ORDER BY d.record_date`,
  ).bind(articleId).all<Record<string, unknown>>();
  return rows.results.filter((d) => d.visibility === "public" || staff).map((d) => ({ ...d, has_file: !!d.original_sha256 }));
}

async function relatedArticles(c: Ctx, a: Record<string, unknown>) {
  const linked = await c.db.prepare(
    `SELECT ${LIST_FIELDS} ${FROM}
      WHERE a.status = 'published' AND a.id != ? AND a.id IN (
        SELECT target_id FROM content_links WHERE source_type='article' AND source_id = ? AND target_type='article'
        UNION SELECT source_id FROM content_links WHERE target_type='article' AND target_id = ? AND source_type='article')
      LIMIT 6`,
  ).bind(a.id, a.id, a.id).all<Record<string, unknown>>();
  const items = linked.results.map(shape);
  if (items.length < 3) {
    const seen = new Set([String(a.id), ...items.map((x) => String(x.id))]);
    const more = await c.db.prepare(
      `SELECT ${LIST_FIELDS} ${FROM}
        WHERE a.status = 'published' AND a.id != ? AND (
          (a.category_id IS NOT NULL AND a.category_id = ?) OR (a.series_id IS NOT NULL AND a.series_id = ?) OR
          EXISTS (SELECT 1 FROM article_tags x JOIN article_tags y ON y.tag_id = x.tag_id WHERE x.article_id = a.id AND y.article_id = ?))
        ORDER BY a.published_at DESC LIMIT 6`,
    ).bind(a.id, a.category_id ?? null, a.series_id ?? null, a.id).all<Record<string, unknown>>();
    for (const r of more.results) if (!seen.has(String(r.id)) && items.length < 4) { items.push(shape(r)); seen.add(String(r.id)); }
  }
  return items;
}

export function registerNews(r: Router): void {
  r.get("/api/news/categories", async (c) => json({ items: (await c.db.prepare("SELECT ac.*, (SELECT COUNT(*) FROM articles a WHERE a.category_id = ac.id AND a.status='published') AS articles FROM article_categories ac ORDER BY sort_order").all()).results }));

  r.get("/api/news", async (c) => {
    const { page, size, offset } = pageParams(c.url, 12, 50);
    const where = ["a.status = 'published'"];
    const args: unknown[] = [];
    const p = (k: string) => c.url.searchParams.get(k);
    if (p("category")) { where.push("a.category_id = ?"); args.push(p("category")); }
    if (p("kind")) { where.push("a.kind = ?"); args.push(p("kind")); }
    if (p("jurisdiction")) { where.push("a.jurisdiction_id = ?"); args.push(p("jurisdiction")); }
    if (p("series")) { where.push("(s.slug = ? OR a.series_id = ?)"); args.push(p("series"), p("series")); }
    if (p("featured") === "1") where.push("a.featured = 1");
    if (p("tag")) { where.push("EXISTS (SELECT 1 FROM article_tags at WHERE at.article_id = a.id AND at.tag_id = ?)"); args.push(p("tag")); }
    if (p("author")) { where.push("a.author_id = ?"); args.push(p("author")); }
    const year = p("year");
    if (year && /^\d{4}$/.test(year)) { where.push("COALESCE(a.original_published_at, a.published_at) LIKE ?"); args.push(`${year}%`); }
    const q = cleanQuery(c.url);
    if (q) {
      where.push("(a.title LIKE ? ESCAPE '\\' OR a.summary LIKE ? ESCAPE '\\' OR a.excerpt LIKE ? ESCAPE '\\' OR a.body LIKE ? ESCAPE '\\' OR a.keywords LIKE ? ESCAPE '\\')");
      const like = likePattern(q);
      args.push(like, like, like, like, like);
    }
    const w = where.join(" AND ");
    const order = p("sort") === "oldest" ? "COALESCE(a.original_published_at, a.published_at) ASC" : "a.published_at DESC";
    const total = await c.db.prepare(`SELECT COUNT(*) AS n ${FROM} WHERE ${w}`).bind(...args).first<{ n: number }>();
    const rows = await c.db.prepare(`SELECT ${LIST_FIELDS} ${FROM} WHERE ${w} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...args, size, offset).all<Record<string, unknown>>();
    return json({ items: rows.results.map(shape), total: total?.n ?? 0, page, pageSize: size });
  });

  r.get("/api/news/:slug", async (c) => {
    const user = await c.user();
    const a = await loadArticle(c, c.params.slug);
    if (!canReadArticle(user, a)) throw new HttpError(404, "Article not found");
    const id = String(a.id);
    const [corrections, citations, related, discussions, versions, documents, relatedStories, series] = await Promise.all([
      c.db.prepare("SELECT id, kind, body, created_at FROM article_corrections WHERE article_id = ? ORDER BY created_at").bind(id).all(),
      citationsFor(c, "article", id),
      relatedContent(c, "article", id),
      discussionsFor(c, "article", id),
      c.db.prepare("SELECT COUNT(*) AS n FROM article_versions WHERE article_id = ?").bind(id).first<{ n: number }>(),
      sourceDocuments(c, id, user),
      relatedArticles(c, a),
      a.series_id
        ? c.db.prepare(`SELECT a.id, a.slug, a.title, a.series_order, a.status FROM articles a WHERE a.series_id = ? AND (a.status = 'published' OR a.id = ?) ORDER BY COALESCE(a.series_order, 999), a.published_at`).bind(a.series_id, id).all()
        : Promise.resolve({ results: [] }),
    ]);
    return json({
      article: shape(a), corrections: corrections.results, citations, related, discussions, documents, relatedStories,
      series: a.series_id ? { id: a.series_id, slug: a.series_slug, title: a.series_title, installments: series.results } : null,
      versionCount: versions?.n ?? 0,
      permissions: { edit: canEditArticle(user, a), publish: can(user, "article.publish"), correct: can(user, "article.correct"), link: can(user, "links.write") },
    });
  });

  r.get("/api/news/:id/versions", async (c) => {
    const user = await c.require("article.draft");
    const a = await loadArticle(c, c.params.id);
    if (a.author_id !== user.id && !can(user, "article.publish")) throw new HttpError(403, "Not permitted");
    const rows = await c.db.prepare("SELECT v.version, v.title, v.summary, v.body, v.status, v.note, v.created_at, u.display_name AS editor FROM article_versions v LEFT JOIN users u ON u.id = v.edited_by WHERE v.article_id = ? ORDER BY v.version DESC").bind(a.id).all();
    return json({ items: rows.results });
  });

  r.get("/api/authors/:id", async (c) => {
    const u = await c.db.prepare("SELECT id, display_name, bio, avatar_url, role, created_at FROM users WHERE id = ? AND state = 'active'").bind(c.params.id).first<Record<string, unknown>>();
    if (!u) throw new HttpError(404, "Profile not found");
    const [articles, discussions, comments] = await Promise.all([
      c.db.prepare(`SELECT ${LIST_FIELDS} ${FROM} WHERE a.author_id = ? AND a.status='published' ORDER BY a.published_at DESC LIMIT 20`).bind(c.params.id).all<Record<string, unknown>>(),
      c.db.prepare("SELECT id, title, comment_count, created_at FROM discussions WHERE created_by = ? AND moderation_state='visible' ORDER BY created_at DESC LIMIT 10").bind(c.params.id).all(),
      c.db.prepare("SELECT COUNT(*) AS n FROM comments WHERE author_id = ? AND moderation_state='visible'").bind(c.params.id).first<{ n: number }>(),
    ]);
    const showRole = roleRank(String(u.role)) >= roleRank("contributor");
    return json({ profile: { ...u, role: showRole ? u.role : "member" }, articles: articles.results.map(shape), discussions: discussions.results, commentCount: comments?.n ?? 0 });
  });

  // ---- workspace
  r.get("/api/workspace/articles", async (c) => {
    const user = await c.require("article.draft");
    const status = c.url.searchParams.get("status");
    const manuscript = c.url.searchParams.get("manuscript");
    const where: string[] = [];
    const args: unknown[] = [];
    if (!can(user, "article.publish")) { where.push("a.author_id = ?"); args.push(user.id); }
    if (status) { where.push("a.status = ?"); args.push(status); }
    if (manuscript) { where.push("a.manuscript_state = ?"); args.push(manuscript); }
    const rows = await c.db.prepare(`SELECT ${LIST_FIELDS}, a.review_note, a.current_version, a.legacy_ref FROM articles a LEFT JOIN users u ON u.id = a.author_id LEFT JOIN article_categories ac ON ac.id = a.category_id
        LEFT JOIN jurisdictions j ON j.id = a.jurisdiction_id LEFT JOIN article_series s ON s.id = a.series_id LEFT JOIN media_assets m ON m.id = a.hero_media_id
        ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY COALESCE(a.updated_at, a.created_at) DESC LIMIT 300`).bind(...args).all<Record<string, unknown>>();
    return json({ items: rows.results.map(shape) });
  });

  r.post("/api/news", async (c) => {
    const user = await c.require("article.draft");
    const b = await c.body(600_000);
    const title = reqStr(b, "title", { min: 5, max: 200 });
    const body = reqStr(b, "body", { min: 20, max: 200_000, trim: false });
    const meta = await metadataFrom(c, b);
    if ("manuscript_state" in meta && !can(user, "article.publish")) throw new HttpError(403, "Only editors may set the manuscript status");
    const id = newId();
    const slug = await uniqueSlug(c, str(b, "slug", { max: 80 }) || title);
    const at = now();
    const cols = ["id", "slug", "title", "body", "status", "access_level", "author_id", "kind", "current_version", "created_at", "updated_at", ...Object.keys(meta).filter((k) => k !== "kind")];
    const vals = [id, slug, title, body, "draft", "public", user.id, meta.kind ?? "report", 1, at, at, ...Object.entries(meta).filter(([k]) => k !== "kind").map(([, v]) => v ?? null)];
    await c.db.batch([
      c.db.prepare(`INSERT INTO articles(${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).bind(...vals),
      c.db.prepare("INSERT INTO article_versions(id,article_id,version,title,summary,body,status,edited_by,note,created_at) VALUES (?,?,1,?,?,?,'draft',?,?,?)").bind(newId(), id, title, (meta.summary as string) ?? null, body, user.id, "Initial draft", at),
    ]);
    await setTags(c, id, stringList(b, "tags", { maxItems: 12, maxLen: 40 }));
    await audit(c, user.id, "article.created", "article", id, { title });
    return json({ id, slug }, 201);
  });

  r.patch("/api/news/:id", async (c) => {
    const user = await c.require("article.draft");
    const a = await loadArticle(c, c.params.id);
    if (!canEditArticle(user, a)) throw new HttpError(403, a.status === "published" ? "Only editors may change a published article" : "You may only edit your own drafts");
    const b = await c.body(600_000);
    const title = "title" in b ? reqStr(b, "title", { min: 5, max: 200 }) : String(a.title);
    const body = "body" in b ? reqStr(b, "body", { min: 20, max: 200_000, trim: false }) : String(a.body);
    const meta = await metadataFrom(c, b);
    if ("manuscript_state" in meta && !can(user, "article.publish")) throw new HttpError(403, "Only editors may change the manuscript status");
    const note = str(b, "change_note", { max: 300 });
    if (a.status === "published" && !note) throw new HttpError(422, "Edits to a published article require a change note. Substantive factual changes also need a public correction.");
    // Slugs are stable once a story has been published: links and shared cards must keep working.
    let slug = String(a.slug);
    if ("slug" in b && str(b, "slug", { max: 80 })) {
      if (a.published_at) throw new HttpError(409, "The URL of a story that has been published cannot change");
      slug = await uniqueSlug(c, str(b, "slug", { max: 80 })!, String(a.id));
    }
    const version = Number(a.current_version) + 1;
    const at = now();
    const sets = ["title = ?", "body = ?", "slug = ?", "current_version = ?", "updated_at = ?", ...Object.keys(meta).map((k) => `${k} = ?`)];
    const summary = "summary" in meta ? (meta.summary as string | null) : (a.summary as string | null);
    await c.db.batch([
      c.db.prepare(`UPDATE articles SET ${sets.join(", ")} WHERE id = ?`).bind(title, body, slug, version, at, ...Object.values(meta).map((v) => v ?? null), a.id),
      c.db.prepare("INSERT INTO article_versions(id,article_id,version,title,summary,body,status,edited_by,note,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(newId(), a.id, version, title, summary, body, a.status, user.id, note, at),
    ]);
    if ("tags" in b) await setTags(c, String(a.id), stringList(b, "tags", { maxItems: 12, maxLen: 40 }));
    await audit(c, user.id, "article.edited", "article", String(a.id), { version, note, fields: Object.keys(b).filter((k) => k !== "body") });
    return json({ ok: true, version, slug });
  });

  r.post("/api/news/:id/submit", async (c) => {
    const user = await c.require("article.draft");
    const a = await loadArticle(c, c.params.id);
    if (a.author_id !== user.id && !can(user, "article.publish")) throw new HttpError(403, "Only the author may submit an article for review");
    if (a.status !== "draft") throw new HttpError(409, "Only drafts can be submitted for review");
    await c.db.prepare("UPDATE articles SET status = 'review', review_note = NULL, updated_at = ? WHERE id = ?").bind(now(), a.id).run();
    const editors = await c.db.prepare("SELECT id FROM users WHERE role IN ('editor','admin','owner') AND state='active' AND id != ? LIMIT 50").bind(user.id).all<{ id: string }>();
    await notify(c, editors.results.map((e) => e.id), "review_requested", "article", String(a.id), `“${a.title}” was submitted for editorial review`, `/workspace/articles/${a.id}`);
    await audit(c, user.id, "article.submitted", "article", String(a.id));
    return json({ ok: true, status: "review" });
  });

  r.post("/api/news/:id/review", async (c) => {
    const user = await c.require("article.publish");
    const a = await loadArticle(c, c.params.id);
    const b = await c.body();
    const decision = oneOf(b, "decision", ["publish", "return"] as const, { required: true })!;
    const note = str(b, "note", { max: 2000 });
    if (a.status !== "review" && a.status !== "draft") throw new HttpError(409, "Only drafts or articles in review can be published or returned");
    if (decision === "publish") {
      if (a.author_id === user.id && roleRank(user.role) < roleRank("admin")) throw new HttpError(403, "A second editor must review and publish your own article");
      if (a.manuscript_state === "needs_manuscript") throw new HttpError(409, "This is a placeholder awaiting the original manuscript. Replace the text and change its manuscript status before publishing.");
      if (a.manuscript_state === "needs_evidence" && b.acknowledge_evidence_gaps !== true) throw new HttpError(409, "This story is flagged as needing supporting evidence. Resolve the gaps or confirm you have reviewed them before publishing.", { code: "evidence_gaps" });
    }
    if (decision === "return" && !note) throw new HttpError(422, "Explain what needs to change when returning an article");
    const at = now();
    if (decision === "publish") {
      await c.db.prepare("UPDATE articles SET status = 'published', published_at = COALESCE(published_at, ?), reviewed_by = ?, review_note = ?, updated_at = ? WHERE id = ?").bind(at, user.id, note, at, a.id).run();
    } else {
      await c.db.prepare("UPDATE articles SET status = 'draft', reviewed_by = ?, review_note = ?, updated_at = ? WHERE id = ?").bind(user.id, note, at, a.id).run();
    }
    if (a.author_id && a.author_id !== user.id) await notify(c, [String(a.author_id)], "review_decision", "article", String(a.id), decision === "publish" ? `“${a.title}” was published` : `“${a.title}” was returned with editor notes`, decision === "publish" ? `/news/${a.slug}` : `/workspace/articles/${a.id}`);
    await audit(c, user.id, decision === "publish" ? "article.published" : "article.returned", "article", String(a.id), { note, manuscript_state: a.manuscript_state });
    return json({ ok: true, status: decision === "publish" ? "published" : "draft" });
  });

  /** Take a published story offline without deleting it. Its URL returns 404 to readers until republished. */
  r.post("/api/news/:id/unpublish", async (c) => {
    const user = await c.require("article.publish");
    const a = await loadArticle(c, c.params.id);
    if (a.status !== "published") throw new HttpError(409, "Only published articles can be unpublished");
    const b = await c.body();
    const reason = reqStr(b, "reason", { min: 5, max: 500 });
    await c.db.prepare("UPDATE articles SET status = 'draft', featured = 0, review_note = ?, updated_at = ? WHERE id = ?").bind(`Unpublished: ${reason}`, now(), a.id).run();
    await audit(c, user.id, "article.unpublished", "article", String(a.id), { reason });
    return json({ ok: true, status: "draft" });
  });

  r.post("/api/news/:id/feature", async (c) => {
    const user = await c.require("article.publish");
    const a = await loadArticle(c, c.params.id);
    const b = await c.body();
    const featured = b.featured === true ? 1 : 0;
    if (featured && a.status !== "published") throw new HttpError(409, "Only published articles can be featured");
    await c.db.prepare("UPDATE articles SET featured = ? WHERE id = ?").bind(featured, a.id).run();
    await audit(c, user.id, featured ? "article.featured" : "article.unfeatured", "article", String(a.id));
    return json({ ok: true, featured: !!featured });
  });

  r.post("/api/news/:id/archive", async (c) => {
    const user = await c.require("article.publish");
    const a = await loadArticle(c, c.params.id);
    const b = await c.body();
    const reason = reqStr(b, "reason", { max: 500 });
    await c.db.prepare("UPDATE articles SET status = 'archived', featured = 0, updated_at = ? WHERE id = ?").bind(now(), a.id).run();
    await audit(c, user.id, "article.archived", "article", String(a.id), { reason });
    return json({ ok: true });
  });

  r.post("/api/news/:id/corrections", async (c) => {
    const user = await c.require("article.correct");
    const a = await loadArticle(c, c.params.id);
    if (a.status !== "published") throw new HttpError(409, "Corrections are appended to published articles only");
    const b = await c.body();
    const id = newId();
    await c.db.prepare("INSERT INTO article_corrections(id,article_id,kind,body,created_by,created_at) VALUES (?,?,?,?,?,?)")
      .bind(id, a.id, oneOf(b, "kind", ["correction", "clarification", "update", "editors_note"] as const, { fallback: "correction" }), reqStr(b, "body", { min: 10, max: 2000 }), user.id, now()).run();
    await c.db.prepare("UPDATE articles SET updated_at = ? WHERE id = ?").bind(now(), a.id).run();
    const followers = await c.db.prepare("SELECT user_id FROM follows WHERE target_type='article' AND target_id = ?").bind(a.id).all<{ user_id: string }>();
    await notify(c, followers.results.map((f) => f.user_id), "correction", "article", String(a.id), `A correction was appended to “${a.title}”`, `/news/${a.slug}#corrections`);
    await audit(c, user.id, "article.corrected", "article", String(a.id), { correction: id });
    return json({ id }, 201);
  });
}
