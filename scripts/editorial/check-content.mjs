#!/usr/bin/env node
// Editorial integrity check against a FORGE database (read-only).
//   node scripts/editorial/check-content.mjs --target local|staging|production
// Reports duplicate slugs, /records/… links in story bodies that point at missing records, citations and
// attachments that reference missing records, covers without an image row, records without an original
// file, and published stories that are still placeholders or flagged.
import { spawnSync } from "node:child_process";

const TARGETS = { local: ["--local"], staging: ["--env", "staging", "--remote"], production: ["--env", "production", "--remote"] };
const target = process.argv[process.argv.indexOf("--target") + 1];
if (!TARGETS[target]) { console.error("Usage: node scripts/editorial/check-content.mjs --target local|staging|production"); process.exit(2); }

function query(sql) {
  const r = spawnSync("npx", ["wrangler", "d1", "execute", "DB", ...TARGETS[target], "--json", "--command", JSON.stringify(sql)], { encoding: "utf8", shell: process.platform === "win32" });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return JSON.parse(r.stdout)[0].results;
}

const problems = [];
const articles = query("SELECT id, slug, title, status, manuscript_state, body, hero_media_id FROM articles");
const docIds = new Set(query("SELECT id FROM documents").map((d) => d.id));
const media = new Set(query("SELECT id FROM media_assets").map((m) => m.id));

const slugs = new Map();
for (const a of articles) slugs.set(a.slug, (slugs.get(a.slug) || 0) + 1);
for (const [slug, n] of slugs) if (n > 1) problems.push(`duplicate slug: ${slug}`);
for (const a of articles) {
  for (const m of a.body.matchAll(/\]\(\/records\/([A-Za-z0-9_-]+)/g)) if (!docIds.has(m[1])) problems.push(`broken record link in “${a.title}”: /records/${m[1]}`);
  for (const m of a.body.matchAll(/\]\(\/api\/media\/([a-z0-9-]+)\/file\)/g)) if (!media.has(m[1])) problems.push(`missing inline image in “${a.title}”: ${m[1]}`);
  if (a.hero_media_id && !media.has(a.hero_media_id)) problems.push(`missing cover image for “${a.title}”`);
  if (a.status === "published" && a.manuscript_state === "needs_manuscript") problems.push(`PUBLISHED placeholder: “${a.title}”`);
}
for (const c of query("SELECT ci.id, ci.document_id FROM citations ci WHERE ci.document_id IS NOT NULL")) if (!docIds.has(c.document_id)) problems.push(`citation ${c.id} points at missing record ${c.document_id}`);
for (const l of query("SELECT id, target_id FROM content_links WHERE source_type='article' AND target_type='document'")) if (!docIds.has(l.target_id)) problems.push(`attachment ${l.id} points at missing record ${l.target_id}`);
const linkedNoFile = query("SELECT DISTINCT d.id FROM content_links l JOIN documents d ON d.id = l.target_id WHERE l.target_type='document' AND d.original_storage_key IS NULL");
for (const d of linkedNoFile) problems.push(`attached record without an original file: ${d.id}`);

const summary = {
  target,
  articles: articles.length,
  by_status: Object.fromEntries(["draft", "review", "published", "archived"].map((s) => [s, articles.filter((a) => a.status === s).length])),
  by_manuscript: Object.fromEntries(["original", "imported", "needs_manuscript", "needs_evidence"].map((s) => [s, articles.filter((a) => a.manuscript_state === s).length])),
  records: docIds.size,
  problems,
};
console.log(JSON.stringify(summary, null, 2));
process.exit(problems.length ? 1 : 0);
