import type { Router, Ctx } from "../lib/context.ts";
import { HttpError, json, pageParams } from "../lib/http.ts";
import { newId } from "../lib/crypto.ts";
import { can, roleRank, type SessionUser } from "../auth/permissions.ts";
import { cleanQuery, likePattern, oneOf, reqStr, slugify, str, stringList, videoUrl } from "../lib/validate.ts";
import { audit, citationsFor, discussionsFor, notify, now, relatedContent } from "../lib/store.ts";

export const ARTICLE_KINDS = ["investigation", "report", "update", "explainer", "commentary"] as const;
const LIST_FIELDS = `a.id, a.slug, a.title, a.summary, a.kind, a.category_id, ac.name AS category_name, a.featured, a.video_url, a.published_at, a.updated_at,
  a.status, a.jurisdiction_id, u.id AS author_id, u.display_name AS author, u.avatar_url AS author_avatar,
  (SELECT COUNT(*) FROM article_corrections cr WHERE cr.article_id = a.id) AS corrections,
  (SELECT GROUP_CONCAT(t.name, '|') FROM article_tags at JOIN tags t ON t.id = at.tag_id WHERE at.article_id = a.id) AS tags`;

function shape(row: Record<string, unknown>) {
  return { ...row, tags: row.tags ? String(row.tags).split("|") : [] };
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

async function loadArticle(c: Ctx, idOrSlug: string) {
  const row = await c.db.prepare(`SELECT ${LIST_FIELDS}, a.body, a.access_level, a.current_version, a.review_note, a.created_at, u.bio AS author_bio
     FROM articles a LEFT JOIN users u ON u.id = a.author_id LEFT JOIN article_categories ac ON ac.id = a.category_id WHERE a.id = ? OR a.slug = ?`).bind(idOrSlug, idOrSlug).first<Record<string, unknown>>();
  if (!row) throw new HttpError(404, "Article not found");
  return row;
}

function canEditArticle(user: SessionUser | null, a: Record<string, unknown>): boolean {
  if (!user) return false;
  if (can(user, "article.publish")) return true;
  return can(user, "article.draft") && a.author_id === user.id && (a.status === "draft" || a.status === "review");
}

async function uniqueSlug(c: Ctx, base: string, exceptId?: string): Promise<string> {
  let slug = slugify(base);
  for (let i = 2; i < 50; i++) {
    const hit = await c.db.prepare("SELECT id FROM articles WHERE slug = ?").bind(slug).first<{ id: string }>();
    if (!hit || hit.id === exceptId) return slug;
    slug = `${slugify(base).slice(0, 72)}-${i}`;
  }
  return `${slugify(base).slice(0, 60)}-${newId().slice(0, 8)}`;
}

export function registerNews(r: Router): void {
  r.get("/api/news/categories", async (c) => json({ items: (await c.db.prepare("SELECT ac.*, (SELECT COUNT(*) FROM articles a WHERE a.category_id = ac.id AND a.status='published') AS articles FROM article_categories ac ORDER BY sort_order").all()).results }));

  r.get("/api/news", async (c) => {
    const { page, size, offset } = pageParams(c.url, 12, 50);
    const where = ["a.status = 'published'"];
    const args: unknown[] = [];
    const cat = c.url.searchParams.get("category");
    if (cat) { where.push("a.category_id = ?"); args.push(cat); }
    const kind = c.url.searchParams.get("kind");
    if (kind) { where.push("a.kind = ?"); args.push(kind); }
    if (c.url.searchParams.get("featured") === "1") where.push("a.featured = 1");
    const tag = c.url.searchParams.get("tag");
    if (tag) { where.push("EXISTS (SELECT 1 FROM article_tags at WHERE at.article_id = a.id AND at.tag_id = ?)"); args.push(tag); }
    const author = c.url.searchParams.get("author");
    if (author) { where.push("a.author_id = ?"); args.push(author); }
    const q = cleanQuery(c.url);
    if (q) { where.push("(a.title LIKE ? ESCAPE '\\' OR a.summary LIKE ? ESCAPE '\\' OR a.body LIKE ? ESCAPE '\\')"); args.push(likePattern(q), likePattern(q), likePattern(q)); }
    const w = where.join(" AND ");
    const total = await c.db.prepare(`SELECT COUNT(*) AS n FROM articles a WHERE ${w}`).bind(...args).first<{ n: number }>();
    const rows = await c.db.prepare(`SELECT ${LIST_FIELDS} FROM articles a LEFT JOIN users u ON u.id = a.author_id LEFT JOIN article_categories ac ON ac.id = a.category_id WHERE ${w} ORDER BY a.published_at DESC LIMIT ? OFFSET ?`)
      .bind(...args, size, offset).all<Record<string, unknown>>();
    return json({ items: rows.results.map(shape), total: total?.n ?? 0, page, pageSize: size });
  });

  r.get("/api/news/:slug", async (c) => {
    const user = await c.user();
    const a = await loadArticle(c, c.params.slug);
    if (a.status !== "published" && !canEditArticle(user, a) && !(user && a.author_id === user.id)) throw new HttpError(404, "Article not found");
    const [corrections, citations, related, discussions, versions] = await Promise.all([
      c.db.prepare("SELECT id, kind, body, created_at FROM article_corrections WHERE article_id = ? ORDER BY created_at").bind(a.id).all(),
      citationsFor(c, "article", String(a.id)),
      relatedContent(c, "article", String(a.id)),
      discussionsFor(c, "article", String(a.id)),
      c.db.prepare("SELECT COUNT(*) AS n FROM article_versions WHERE article_id = ?").bind(a.id).first<{ n: number }>(),
    ]);
    return json({ article: shape(a), corrections: corrections.results, citations, related, discussions, versionCount: versions?.n ?? 0, permissions: { edit: canEditArticle(user, a), publish: can(user, "article.publish"), correct: can(user, "article.correct") } });
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
      c.db.prepare(`SELECT ${LIST_FIELDS} FROM articles a LEFT JOIN users u ON u.id = a.author_id LEFT JOIN article_categories ac ON ac.id = a.category_id WHERE a.author_id = ? AND a.status='published' ORDER BY a.published_at DESC LIMIT 20`).bind(c.params.id).all<Record<string, unknown>>(),
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
    const where: string[] = [];
    const args: unknown[] = [];
    if (!can(user, "article.publish")) { where.push("a.author_id = ?"); args.push(user.id); }
    if (status) { where.push("a.status = ?"); args.push(status); }
    const rows = await c.db.prepare(`SELECT ${LIST_FIELDS}, a.review_note, a.current_version FROM articles a LEFT JOIN users u ON u.id = a.author_id LEFT JOIN article_categories ac ON ac.id = a.category_id ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY COALESCE(a.updated_at, a.created_at) DESC LIMIT 200`).bind(...args).all<Record<string, unknown>>();
    return json({ items: rows.results.map(shape) });
  });

  r.post("/api/news", async (c) => {
    const user = await c.require("article.draft");
    const b = await c.body(600_000);
    const title = reqStr(b, "title", { min: 5, max: 200 });
    const body = reqStr(b, "body", { min: 20, max: 200_000, trim: false });
    const summary = str(b, "summary", { max: 600 });
    const category = str(b, "category_id", { max: 40 });
    if (category && !(await c.db.prepare("SELECT 1 FROM article_categories WHERE id = ?").bind(category).first())) throw new HttpError(422, "Unknown category");
    const id = newId();
    const slug = await uniqueSlug(c, str(b, "slug", { max: 80 }) || title);
    const at = now();
    await c.db.batch([
      c.db.prepare(`INSERT INTO articles(id,slug,title,summary,body,status,access_level,author_id,category_id,kind,video_url,jurisdiction_id,current_version,created_at,updated_at)
                    VALUES (?,?,?,?,?,'draft','public',?,?,?,?,?,1,?,?)`).bind(id, slug, title, summary, body, user.id, category, oneOf(b, "kind", ARTICLE_KINDS, { fallback: "report" }), videoUrl(b), str(b, "jurisdiction_id", { max: 80 }), at, at),
      c.db.prepare("INSERT INTO article_versions(id,article_id,version,title,summary,body,status,edited_by,note,created_at) VALUES (?,?,1,?,?,?,'draft',?,?,?)").bind(newId(), id, title, summary, body, user.id, "Initial draft", at),
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
    const summary = "summary" in b ? str(b, "summary", { max: 600 }) : (a.summary as string | null);
    const body = "body" in b ? reqStr(b, "body", { min: 20, max: 200_000, trim: false }) : String(a.body);
    const note = str(b, "change_note", { max: 300 });
    if (a.status === "published" && !note) throw new HttpError(422, "Edits to a published article require a change note. Substantive factual changes also need a public correction.");
    const version = Number(a.current_version) + 1;
    const at = now();
    const category = "category_id" in b ? str(b, "category_id", { max: 40 }) : (a.category_id as string | null);
    await c.db.batch([
      c.db.prepare("UPDATE articles SET title = ?, summary = ?, body = ?, category_id = ?, kind = ?, video_url = ?, jurisdiction_id = ?, current_version = ?, updated_at = ? WHERE id = ?")
        .bind(title, summary, body, category, "kind" in b ? oneOf(b, "kind", ARTICLE_KINDS, { required: true }) : a.kind, "video_url" in b ? videoUrl(b) : a.video_url, "jurisdiction_id" in b ? str(b, "jurisdiction_id", { max: 80 }) : a.jurisdiction_id, version, at, a.id),
      c.db.prepare("INSERT INTO article_versions(id,article_id,version,title,summary,body,status,edited_by,note,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(newId(), a.id, version, title, summary, body, a.status, user.id, note, at),
    ]);
    if ("tags" in b) await setTags(c, String(a.id), stringList(b, "tags", { maxItems: 12, maxLen: 40 }));
    await audit(c, user.id, "article.edited", "article", String(a.id), { version, note });
    return json({ ok: true, version });
  });

  r.post("/api/news/:id/submit", async (c) => {
    const user = await c.require("article.draft");
    const a = await loadArticle(c, c.params.id);
    if (a.author_id !== user.id) throw new HttpError(403, "Only the author may submit an article for review");
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
    if (decision === "publish" && a.author_id === user.id && roleRank(user.role) < roleRank("admin")) throw new HttpError(403, "A second editor must review and publish your own article");
    if (decision === "return" && !note) throw new HttpError(422, "Explain what needs to change when returning an article");
    const at = now();
    if (decision === "publish") {
      await c.db.prepare("UPDATE articles SET status = 'published', published_at = COALESCE(published_at, ?), reviewed_by = ?, review_note = ?, updated_at = ? WHERE id = ?").bind(at, user.id, note, at, a.id).run();
    } else {
      await c.db.prepare("UPDATE articles SET status = 'draft', reviewed_by = ?, review_note = ?, updated_at = ? WHERE id = ?").bind(user.id, note, at, a.id).run();
    }
    if (a.author_id && a.author_id !== user.id) await notify(c, [String(a.author_id)], "review_decision", "article", String(a.id), decision === "publish" ? `“${a.title}” was published` : `“${a.title}” was returned with editor notes`, decision === "publish" ? `/news/${a.slug}` : `/workspace/articles/${a.id}`);
    await audit(c, user.id, decision === "publish" ? "article.published" : "article.returned", "article", String(a.id), { note });
    return json({ ok: true, status: decision === "publish" ? "published" : "draft" });
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
    const followers = await c.db.prepare("SELECT user_id FROM follows WHERE target_type='article' AND target_id = ?").bind(a.id).all<{ user_id: string }>();
    await notify(c, followers.results.map((f) => f.user_id), "correction", "article", String(a.id), `A correction was appended to “${a.title}”`, `/news/${a.slug}#corrections`);
    await audit(c, user.id, "article.corrected", "article", String(a.id), { correction: id });
    return json({ id }, 201);
  });
}
