import type { Router, Ctx } from "../lib/context.ts";
import type { Env } from "../env.ts";
import { HttpError, json } from "../lib/http.ts";
import { newId } from "../lib/crypto.ts";
import { can } from "../auth/permissions.ts";
import { oneOf, reqStr, slugify, str } from "../lib/validate.ts";
import { audit, now } from "../lib/store.ts";
import { readUpload } from "./records.ts";

export const IMAGE_MIME = ["image/png", "image/jpeg", "image/webp"] as const;
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/** Read pixel dimensions from PNG, JPEG or WebP headers without decoding the image. */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const u16 = (i: number) => (b[i] << 8) | b[i + 1];
  const u32 = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  if (b[0] === 0x89 && b[1] === 0x50) return { width: u32(16), height: u32(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      const len = u16(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: u16(i + 7), height: u16(i + 5) };
      i += 2 + len;
    }
    return null;
  }
  if (b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (chunk === "VP8X") return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    if (chunk === "VP8 ") return { width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
    if (chunk === "VP8L") { const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24); return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }; }
  }
  return null;
}

async function mediaIsPublic(c: Ctx, id: string): Promise<boolean> {
  const hit = await c.db.prepare(
    `SELECT 1 FROM articles WHERE hero_media_id = ? AND status = 'published'
     UNION SELECT 1 FROM article_series WHERE hero_media_id = ? AND status = 'published' LIMIT 1`,
  ).bind(id, id).first();
  return !!hit;
}

export function registerEditorial(r: Router): void {
  // ---------------------------------------------------------------- media library
  r.get("/api/media", async (c) => {
    await c.require("article.draft");
    const rows = await c.db.prepare("SELECT id, alt_text, caption, credit, is_illustration, width, height, mime_type, file_size, original_filename, created_at FROM media_assets ORDER BY created_at DESC LIMIT 100").all();
    return json({ items: rows.results.map((m) => ({ ...m, url: `/api/media/${m.id}/file` })) });
  });

  r.post("/api/media", async (c) => {
    const user = await c.require("article.draft");
    const up = await readUpload(c, IMAGE_MIME, MAX_IMAGE_BYTES);
    // Metadata travels in the same multipart form as the file.
    const field = (k: string) => { const v = up.form.get(k); return typeof v === "string" ? v.trim() : ""; };
    const alt = field("alt_text");
    if (alt.length < 8) throw new HttpError(422, "Describe the image for screen-reader users (alt text, at least 8 characters)", { field: "alt_text" });
    if (alt.length > 400) throw new HttpError(422, "Alt text is too long", { field: "alt_text" });
    const dup = await c.db.prepare("SELECT id FROM media_assets WHERE sha256 = ?").bind(up.sha256).first<{ id: string }>();
    if (dup) return json({ id: dup.id, url: `/api/media/${dup.id}/file`, duplicate: true });
    const id = newId();
    const ext = up.mime === "image/png" ? "png" : up.mime === "image/webp" ? "webp" : "jpg";
    const key = `media/${new Date().getUTCFullYear()}/${id}.${ext}`;
    const size = imageSize(up.bytes);
    await c.bucket.put(key, up.bytes, { httpMetadata: { contentType: up.mime }, customMetadata: { sha256: up.sha256, mediaId: id, uploadedBy: user.id }, sha256: up.sha256 });
    await c.db.prepare(`INSERT INTO media_assets(id,storage_key,sha256,mime_type,file_size,width,height,original_filename,alt_text,caption,credit,is_illustration,created_by,created_at)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, key, up.sha256, up.mime, up.bytes.byteLength, size?.width ?? null, size?.height ?? null, up.filename, alt, field("caption").slice(0, 600) || null, field("credit").slice(0, 200) || null, field("is_illustration") === "true" ? 1 : 0, user.id, now()).run();
    await audit(c, user.id, "media.uploaded", "media", id, { sha256: up.sha256, size: up.bytes.byteLength });
    return json({ id, url: `/api/media/${id}/file`, width: size?.width ?? null, height: size?.height ?? null }, 201);
  });

  r.patch("/api/media/:id", async (c) => {
    const user = await c.require("article.draft");
    const row = await c.db.prepare("SELECT created_by FROM media_assets WHERE id = ?").bind(c.params.id).first<{ created_by: string }>();
    if (!row) throw new HttpError(404, "Image not found");
    if (row.created_by !== user.id && !can(user, "article.publish")) throw new HttpError(403, "Not permitted");
    const b = await c.body();
    const sets: string[] = [];
    const args: unknown[] = [];
    if ("alt_text" in b) { sets.push("alt_text = ?"); args.push(reqStr(b, "alt_text", { min: 8, max: 400 })); }
    if ("caption" in b) { sets.push("caption = ?"); args.push(str(b, "caption", { max: 600 })); }
    if ("credit" in b) { sets.push("credit = ?"); args.push(str(b, "credit", { max: 200 })); }
    if ("is_illustration" in b) { sets.push("is_illustration = ?"); args.push(b.is_illustration === true ? 1 : 0); }
    if (!sets.length) throw new HttpError(422, "No changes supplied");
    await c.db.prepare(`UPDATE media_assets SET ${sets.join(", ")} WHERE id = ?`).bind(...args, c.params.id).run();
    await audit(c, user.id, "media.updated", "media", c.params.id, { fields: Object.keys(b) });
    return json({ ok: true });
  });

  r.get("/api/media/:id/file", async (c) => {
    const row = await c.db.prepare("SELECT storage_key, mime_type, sha256 FROM media_assets WHERE id = ?").bind(c.params.id).first<Record<string, string>>();
    if (!row) throw new HttpError(404, "Image not found");
    const isPublic = await mediaIsPublic(c, c.params.id);
    if (!isPublic && !can(await c.user(), "article.draft")) throw new HttpError(404, "Image not found");
    const obj = await c.bucket.get(row.storage_key);
    if (!obj) throw new HttpError(404, "The stored image is missing");
    return new Response(obj.body, {
      headers: {
        "content-type": row.mime_type,
        "cache-control": isPublic ? "public, max-age=86400" : "private, no-store",
        "x-content-type-options": "nosniff",
        "x-forge-sha256": row.sha256,
        "cross-origin-resource-policy": "same-site",
      },
    });
  });

  // ---------------------------------------------------------------- series and investigations
  r.get("/api/series", async (c) => {
    const user = await c.user();
    const staff = can(user, "article.publish");
    const rows = await c.db.prepare(
      `SELECT s.id, s.slug, s.title, s.description, s.kind, s.status, s.jurisdiction_id, s.hero_media_id,
              (SELECT COUNT(*) FROM articles a WHERE a.series_id = s.id AND a.status = 'published') AS published_count,
              (SELECT COUNT(*) FROM articles a WHERE a.series_id = s.id) AS total_count,
              (SELECT MAX(a.published_at) FROM articles a WHERE a.series_id = s.id AND a.status = 'published') AS last_published_at
         FROM article_series s ${staff ? "" : "WHERE s.status = 'published'"} ORDER BY last_published_at DESC, s.title`,
    ).all<Record<string, unknown>>();
    return json({ items: rows.results.map((s) => ({ ...s, hero_url: s.hero_media_id ? `/api/media/${s.hero_media_id}/file` : null })) });
  });

  r.get("/api/series/:slug", async (c) => {
    const user = await c.user();
    const s = await c.db.prepare("SELECT * FROM article_series WHERE slug = ? OR id = ?").bind(c.params.slug, c.params.slug).first<Record<string, unknown>>();
    if (!s || (s.status !== "published" && !can(user, "article.publish"))) throw new HttpError(404, "Series not found");
    const staff = can(user, "article.publish");
    const rows = await c.db.prepare(
      `SELECT a.id, a.slug, a.title, a.summary, a.excerpt, a.kind, a.status, a.series_order, a.published_at, a.original_published_at, a.byline, u.display_name AS author
         FROM articles a LEFT JOIN users u ON u.id = a.author_id WHERE a.series_id = ? ${staff ? "" : "AND a.status = 'published'"}
        ORDER BY COALESCE(a.series_order, 999), COALESCE(a.original_published_at, a.published_at)`,
    ).bind(s.id).all<Record<string, unknown>>();
    return json({ series: { ...s, hero_url: s.hero_media_id ? `/api/media/${s.hero_media_id}/file` : null }, items: rows.results.map((a) => ({ ...a, byline: a.byline || a.author || "1776 FORGE staff" })), permissions: { edit: staff } });
  });

  r.post("/api/series", async (c) => {
    const user = await c.require("article.publish");
    const b = await c.body();
    const title = reqStr(b, "title", { min: 3, max: 200 });
    let slug = slugify(str(b, "slug", { max: 80 }) || title);
    if (await c.db.prepare("SELECT 1 FROM article_series WHERE slug = ?").bind(slug).first()) slug = `${slug.slice(0, 70)}-${newId().slice(0, 6)}`;
    const id = newId();
    await c.db.prepare("INSERT INTO article_series(id,slug,title,description,kind,jurisdiction_id,status,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(id, slug, title, str(b, "description", { max: 2000 }), oneOf(b, "kind", ["series", "investigation"] as const, { fallback: "series" }), str(b, "jurisdiction_id", { max: 80 }),
        oneOf(b, "status", ["draft", "published"] as const, { fallback: "draft" }), user.id, now(), now()).run();
    await audit(c, user.id, "series.created", "series", id, { title });
    return json({ id, slug }, 201);
  });

  r.patch("/api/series/:id", async (c) => {
    const user = await c.require("article.publish");
    if (!(await c.db.prepare("SELECT 1 FROM article_series WHERE id = ?").bind(c.params.id).first())) throw new HttpError(404, "Series not found");
    const b = await c.body();
    const sets: string[] = [];
    const args: unknown[] = [];
    const set = (k: string, v: unknown) => { sets.push(`${k} = ?`); args.push(v); };
    if ("title" in b) set("title", reqStr(b, "title", { min: 3, max: 200 }));
    if ("description" in b) set("description", str(b, "description", { max: 2000 }));
    if ("kind" in b) set("kind", oneOf(b, "kind", ["series", "investigation"] as const, { required: true }));
    if ("status" in b) set("status", oneOf(b, "status", ["draft", "published", "archived"] as const, { required: true }));
    if ("jurisdiction_id" in b) set("jurisdiction_id", str(b, "jurisdiction_id", { max: 80 }));
    if ("hero_media_id" in b) set("hero_media_id", str(b, "hero_media_id", { max: 80 }));
    if (!sets.length) throw new HttpError(422, "No changes supplied");
    set("updated_at", now());
    await c.db.prepare(`UPDATE article_series SET ${sets.join(", ")} WHERE id = ?`).bind(...args, c.params.id).run();
    await audit(c, user.id, "series.updated", "series", c.params.id, { fields: Object.keys(b) });
    return json({ ok: true });
  });

  // ---------------------------------------------------------------- source verification
  r.post("/api/citations/:id/verify", async (c) => {
    const user = await c.require("article.publish");
    const row = await c.db.prepare("SELECT id, subject_type, subject_id FROM citations WHERE id = ?").bind(c.params.id).first<Record<string, string>>();
    if (!row) throw new HttpError(404, "Citation not found");
    const b = await c.body();
    const verified = b.verified !== false;
    await c.db.prepare("UPDATE citations SET verified_at = ?, verified_by = ? WHERE id = ?").bind(verified ? now() : null, verified ? user.id : null, row.id).run();
    await audit(c, user.id, verified ? "citation.verified" : "citation.unverified", row.subject_type, row.subject_id, { citation: row.id });
    return json({ ok: true, verified });
  });
}

// ---------------------------------------------------------------- crawler metadata (outside /api)
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
const xml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[ch]!);

export interface PageMeta { title: string; description: string; canonical: string; image?: string | null; imageAlt?: string | null; type?: string; published?: string | null; modified?: string | null; author?: string | null; noindex?: boolean; jsonLd?: unknown }

/** Replace the shell's generic <title>/description/Open Graph tags with page-specific ones. */
export function injectMeta(html: string, m: PageMeta): string {
  const tags = [
    `<title>${esc(m.title)}</title>`,
    `<meta name="description" content="${esc(m.description)}">`,
    `<link rel="canonical" href="${esc(m.canonical)}">`,
    `<meta property="og:site_name" content="1776 FORGE">`,
    `<meta property="og:title" content="${esc(m.title)}">`,
    `<meta property="og:description" content="${esc(m.description)}">`,
    `<meta property="og:url" content="${esc(m.canonical)}">`,
    `<meta property="og:type" content="${esc(m.type || "website")}">`,
    `<meta property="og:image" content="${esc(m.image || new URL("/assets/brand/og-image.jpg", m.canonical).href)}">`,
    m.imageAlt ? `<meta property="og:image:alt" content="${esc(m.imageAlt)}">` : "",
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(m.title)}">`,
    `<meta name="twitter:description" content="${esc(m.description)}">`,
    m.published ? `<meta property="article:published_time" content="${esc(m.published)}">` : "",
    m.modified ? `<meta property="article:modified_time" content="${esc(m.modified)}">` : "",
    m.author ? `<meta property="article:author" content="${esc(m.author)}">` : "",
    m.noindex ? `<meta name="robots" content="noindex">` : "",
    m.jsonLd ? `<script type="application/ld+json">${JSON.stringify(m.jsonLd).replace(/</g, "\\u003c")}</script>` : "",
  ].filter(Boolean).join("\n  ");
  return html
    .replace(/<title>[\s\S]*?<\/title>\s*/, "")
    .replace(/<meta name="description"[^>]*>\s*/, "")
    .replace(/<meta property="og:[^"]+"[^>]*>\s*/g, "")
    .replace(/<meta name="twitter:card"[^>]*>\s*/, "")
    .replace("</head>", `  ${tags}\n</head>`);
}

function plainText(md: string, max = 200): string {
  const t = md.replace(/```[\s\S]*?```/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[#>*_`|-]+/g, " ").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1).replace(/\s+\S*$/, "") + "…" : t;
}

/** Page metadata for crawlers and link previews. Unpublished stories get the generic shell and noindex. */
export async function pageMetaFor(env: Env, url: URL): Promise<PageMeta | null> {
  if (!env.DB) return null;
  const canonical = url.origin + url.pathname.replace(/\/+$/, "");
  const series = url.pathname.match(/^\/news\/series\/([a-z0-9-]{1,90})\/?$/);
  if (series) {
    const s = await env.DB.prepare("SELECT title, description, hero_media_id FROM article_series WHERE slug = ? AND status = 'published'").bind(series[1]).first<Record<string, string>>();
    if (!s) return { title: "Not found · 1776 FORGE", description: "This page is not available.", canonical, noindex: true };
    return { title: `${s.title} · 1776 FORGE`, description: plainText(s.description || s.title), canonical, image: s.hero_media_id ? `${url.origin}/api/media/${s.hero_media_id}/file` : null };
  }
  const story = url.pathname.match(/^\/news\/([a-z0-9-]{1,90})\/?$/);
  if (!story) return null;
  const a = await env.DB.prepare(
    `SELECT a.slug, a.title, a.summary, a.excerpt, a.seo_title, a.seo_description, a.keywords, a.body, a.status, a.published_at, a.updated_at, a.kind,
            a.original_publisher, a.original_published_at, a.byline, u.display_name AS author, a.hero_media_id, m.alt_text
       FROM articles a LEFT JOIN users u ON u.id = a.author_id LEFT JOIN media_assets m ON m.id = a.hero_media_id WHERE a.slug = ?`,
  ).bind(story[1]).first<Record<string, string>>();
  if (!a || a.status !== "published") return { title: "1776 FORGE Newsroom", description: "Evidence-backed reporting from 1776 FORGE.", canonical, noindex: true };
  const description = a.seo_description || a.excerpt || a.summary || plainText(a.body);
  const byline = a.byline || a.author || "1776 FORGE";
  const image = a.hero_media_id ? `${url.origin}/api/media/${a.hero_media_id}/file` : null;
  const canonicalStory = `${url.origin}/news/${a.slug}`;
  return {
    title: `${a.seo_title || a.title} · 1776 FORGE`, description, canonical: canonicalStory, image, imageAlt: a.alt_text, type: "article",
    published: a.published_at, modified: a.updated_at, author: byline,
    jsonLd: {
      "@context": "https://schema.org", "@type": a.kind === "commentary" || a.kind === "personal_essay" ? "OpinionNewsArticle" : "NewsArticle",
      headline: a.title, description, url: canonicalStory, datePublished: a.published_at, dateModified: a.updated_at || a.published_at,
      author: { "@type": "Person", name: byline }, publisher: { "@type": "Organization", name: "1776 FORGE" },
      ...(image ? { image: [image] } : {}), ...(a.keywords ? { keywords: a.keywords } : {}),
      ...(a.original_published_at ? { isBasedOn: { "@type": "CreativeWork", publisher: a.original_publisher || undefined, datePublished: a.original_published_at } } : {}),
    },
  };
}

const STATIC_PATHS = ["/", "/news", "/news/series", "/records", "/map", "/government", "/law", "/resources", "/community", "/about", "/standards"];

export async function sitemap(env: Env, origin: string): Promise<Response> {
  const urls: { loc: string; lastmod?: string }[] = STATIC_PATHS.map((p) => ({ loc: origin + p }));
  if (env.DB) {
    const articles = await env.DB.prepare("SELECT slug, COALESCE(updated_at, published_at) AS m FROM articles WHERE status = 'published' ORDER BY published_at DESC LIMIT 5000").all<{ slug: string; m: string }>();
    for (const a of articles.results) urls.push({ loc: `${origin}/news/${a.slug}`, lastmod: a.m?.slice(0, 10) });
    const series = await env.DB.prepare("SELECT slug, updated_at FROM article_series WHERE status = 'published'").all<{ slug: string; updated_at: string }>();
    for (const s of series.results) urls.push({ loc: `${origin}/news/series/${s.slug}`, lastmod: s.updated_at?.slice(0, 10) });
  }
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${xml(u.loc)}</loc>${u.lastmod ? `<lastmod>${xml(u.lastmod)}</lastmod>` : ""}</url>`).join("\n")}\n</urlset>\n`;
  return new Response(body, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff" } });
}

export function robots(origin: string, env: Env): Response {
  const indexable = env.APP_ENV === "production";
  const body = indexable
    ? `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /workspace\nDisallow: /admin\nDisallow: /account\nSitemap: ${origin}/sitemap.xml\n`
    : `# Non-production environment: not for indexing.\nUser-agent: *\nDisallow: /\n`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
