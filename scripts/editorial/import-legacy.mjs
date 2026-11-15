#!/usr/bin/env node
// Import the legacy reporting inventory into a 1776 FORGE database.
//
//   node scripts/editorial/import-legacy.mjs --source-root "C:\Users\<you>\Documents" --target local
//   node scripts/editorial/import-legacy.mjs --source-root "..." --target staging      (NEW staging D1/R2 only)
//   node scripts/editorial/import-legacy.mjs --source-root "..." --target production --confirm-production
//   add --dry-run to print the plan without writing anything.
//
// Safety:
// * Manuscripts and original PDFs are read from the owner's local folders, checked against the SHA-256 in
//   legacy-inventory.json and refused on any mismatch. Nothing from those folders is written into git.
// * Every story is created as a nonpublic DRAFT. Placeholders are marked needs_manuscript and cannot be published.
// * Inserts use INSERT OR IGNORE with stable IDs, so re-running never duplicates records or overwrites edits.
// * Production (the NEW forge-db / forge-documents only) requires --confirm-production. The import only adds
//   rows; its one UPDATE fills a missing author on imported drafts once an owner account exists.
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, basename, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGETS = {
  local: { d1: ["--local"], r2Bucket: "forge-documents-dev", r2: ["--local"] },
  staging: { d1: ["--env", "staging", "--remote"], r2Bucket: "forge-documents-staging", r2: ["--env", "staging", "--remote"] },
  production: { d1: ["--env", "production", "--remote"], r2Bucket: "forge-documents", r2: ["--env", "production", "--remote"] },
};

export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const sql = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
/** Stable UUID-shaped id derived from a namespace and key, so re-runs address the same rows. */
export function stableId(ns, key) {
  const x = sha256(`1776-forge:${ns}:${key}`);
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-5${x.slice(13, 16)}-a${x.slice(17, 20)}-${x.slice(20, 32)}`;
}

const LEGACY_DOC = /^https:\/\/baldwin-minute-watch-v21\.otiseduncan\.workers\.dev\/document\?id=([A-Za-z0-9_-]+)(#page=\d+)?$/;

/**
 * Turn the manuscript into FORGE body Markdown. Each transformation is recorded so the provenance note
 * states exactly how the published text differs from the source file. Wording is never changed.
 */
export function transform(kind, text, { migratedDocs = new Set(), recordingUrl } = {}) {
  const edits = [];
  let lines = text.replace(/\r\n?/g, "\n").split("\n");
  const dropFirst = (re, why) => { const i = lines.findIndex((l) => l.trim()); if (i >= 0 && re.test(lines[i])) { lines.splice(i, 1); edits.push(why); } };
  dropFirst(/^#\s/, "Removed the H1 headline line (the headline is stored separately).");

  if (kind === "keim") {
    const top = lines.slice(0, 6).map((l) => l.trim());
    if (top.includes("November 6, 2026") && top.includes("Baldwin Minute Watch")) {
      lines = lines.filter((l, i) => !(i < 6 && (l.trim() === "November 6, 2026" || l.trim() === "Baldwin Minute Watch")));
      edits.push("Removed the dateline and publication-name lines under the headline (kept as original publication metadata).");
    }
    const tail = lines.map((l) => l.trim());
    const sign = tail.lastIndexOf("Baldwin Minute Watch");
    if (sign > lines.length - 4) { lines.splice(sign, 2); edits.push("Removed the closing Baldwin Minute Watch sign-off and slogan lines."); }
    // "Label:  \nURL" pairs become Markdown links; legacy archive document links point at the migrated FORGE record.
    const out = [];
    let relinked = 0, recording = 0;
    for (let i = 0; i < lines.length; i++) {
      const label = lines[i].trimEnd();
      const next = (lines[i + 1] || "").trim();
      if (/:\s*$/.test(label) && /^https:\/\//.test(next)) {
        const m = LEGACY_DOC.exec(next);
        let href = next;
        if (m && migratedDocs.has(m[1])) { href = `/records/${m[1]}`; relinked++; }
        else if (m && /playback_copy$/.test(m[1]) && recordingUrl) { href = recordingUrl; recording++; }
        out.push(`[${label.replace(/:\s*$/, "")}](${href})`);
        i++;
        continue;
      }
      out.push(lines[i]);
    }
    lines = out;
    if (relinked) edits.push(`Converted ${relinked} source citations from bare legacy-archive URLs to links to the same original documents in the FORGE records library (identical SHA-256).`);
    if (recording) edits.push("The full-recording link now points to Baldwin County's original public recording instead of the legacy archive's playback copy of it.");
  }
  if (kind === "hospital") {
    lines = lines.filter((l) => { const drop = /^\*\*Baldwin Minute Watch publication draft/.test(l.trim()); if (drop) edits.push("Removed the internal 'publication draft — not published' status line."); return !drop; });
    const rule = lines.map((l) => l.trim()).lastIndexOf("---");
    if (rule > 0 && lines.slice(rule).some((l) => l.includes("**Research materials:**"))) { lines = lines.slice(0, rule); edits.push("Removed the closing 'Research materials' list, which linked to local working files that are not public."); }
    let unlinked = 0;
    lines = lines.map((l) => l.replace(/\[([^\]]+)\]\((?!https?:|\/)[^)]+\)/g, (_m, t) => { unlinked++; return t; }));
    if (unlinked) edits.push(`Unlinked ${unlinked} references to local research files (text kept, link removed).`);
  }
  if (kind === "putnam") {
    dropFirst(/^\*\*Putnam County: bring the original records/, "Removed the bold headline line (stored as the headline).");
    const note = lines.findIndex((l) => l.startsWith("Editorial note:"));
    if (note >= 0) { lines.splice(note, 1); edits.push("Moved the internal 'Editorial note' (evidence cutoff and verification limits) out of the body into the evidence-gap record."); }
  }
  if (kind === "strip-title") {
    lines = lines.map((l) => { if (l.startsWith("**DRAFT FOR REVIEW — NOT POSTED.** ")) { edits.push("Removed the 'DRAFT FOR REVIEW — NOT POSTED.' prefix; the verification caveat that followed it is kept."); return l.replace("**DRAFT FOR REVIEW — NOT POSTED.** ", ""); } return l; });
  }
  const body = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  return { body, edits };
}

function placeholderBody(s) {
  return [
    "**NEEDS ORIGINAL MANUSCRIPT**",
    "",
    `Inventory lead: “${s.lead}”.`,
    "",
    "This is a nonpublic placeholder created during the legacy reporting inventory. It is not a story and contains no reporting. Paste the complete original manuscript here, attach its source documents, then change the manuscript status.",
    "",
    `Inventory finding: ${s.related || "No manuscript was found."}`,
    "",
  ].join("\n");
}

export function buildPlan(inv, sourceRoot, { readFile = (p) => readFileSync(p), exists = existsSync, now = new Date().toISOString() } = {}) {
  const problems = [];
  const docs = [];
  for (const d of inv.documents) {
    const path = join(sourceRoot, d.file);
    if (!exists(path)) { problems.push(`missing document file: ${d.file}`); continue; }
    const bytes = readFile(path);
    const got = sha256(bytes);
    if (got !== d.sha256) { problems.push(`SHA-256 mismatch for ${d.file}: expected ${d.sha256}, got ${got}`); continue; }
    docs.push({ ...d, path, bytes: bytes.length, key: `documents/${d.record_date.slice(0, 4)}/${d.id}/${basename(d.file)}` });
  }
  const migrated = new Set(docs.map((d) => d.id));
  const stories = [];
  for (const s of inv.stories) {
    const id = stableId("article", s.ref);
    if (s.decision === "import") {
      const path = join(sourceRoot, s.manuscript.file);
      if (!exists(path)) { problems.push(`missing manuscript: ${s.manuscript.file}`); continue; }
      const raw = readFile(path);
      const got = sha256(raw);
      if (got !== s.manuscript.sha256) { problems.push(`SHA-256 mismatch for manuscript ${s.manuscript.file}: expected ${s.manuscript.sha256}, got ${got}`); continue; }
      const recording = s.citations?.find((c) => c.url?.includes("youtube.com/live/"))?.url;
      const { body, edits } = transform(s.manuscript.transform, raw.toString("utf8"), { migratedDocs: migrated, recordingUrl: recording });
      const provenance = [
        `Imported ${now.slice(0, 10)} from the owner's local research archive.`,
        `Source file: ${s.manuscript.file}`,
        `Source SHA-256: ${s.manuscript.sha256}`,
        `Imported body SHA-256: ${sha256(body)}`,
        s.original_headline ? `Original headline: ${s.original_headline}` : null,
        "Edits made on import (wording unchanged):",
        ...(edits.length ? edits.map((e) => `- ${e}`) : ["- None."]),
        s.evidence_gaps ? `Evidence gaps: ${s.evidence_gaps}` : null,
      ].filter(Boolean).join("\n");
      stories.push({ ...s, id, slug: s.slug || slugify(s.title), body, provenance, docIds: (s.documents || []).filter((x) => migrated.has(x)) });
    } else {
      stories.push({ ...s, id, title: s.lead, slug: `inventory-${s.ref}`, body: placeholderBody(s), manuscript_state: "needs_manuscript",
        provenance: `Inventory placeholder created ${now.slice(0, 10)}. Lead: “${s.lead}”. ${s.related || ""}`.trim(), docIds: [] });
    }
  }
  return { docs, stories, problems };
}

function slugify(t) {
  return t.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

export function planToSql(inv, plan, now = new Date().toISOString()) {
  const out = ["-- Generated by scripts/editorial/import-legacy.mjs. Idempotent: INSERT OR IGNORE throughout."];
  const owner = "(SELECT id FROM users WHERE role = 'owner' AND state = 'active' ORDER BY created_at LIMIT 1)";
  for (const s of inv.series) {
    out.push(`INSERT OR IGNORE INTO article_series(id,slug,title,description,kind,jurisdiction_id,status,created_at,updated_at) VALUES (${[s.id, s.slug, s.title, s.description, s.kind, s.jurisdiction_id, s.status, now, now].map(sql).join(",")});`);
  }
  for (const d of plan.docs) {
    out.push(`INSERT OR IGNORE INTO documents(id,jurisdiction_id,title,document_type,category_id,summary,record_date,source_url,source_kind,original_storage_key,original_sha256,mime_type,file_size,original_filename,verification_state,visibility,imported_legacy_id,integrity_state,integrity_checked_at,created_at,updated_at)
  VALUES (${[d.id, "ga-baldwin", d.title, d.document_type, d.category_id, d.summary, d.record_date, d.source_url, "official", d.key, d.sha256, "application/pdf", d.bytes, basename(d.file), "unreviewed", "public", d.id, "ok", now, now, now].map(sql).join(",")});`);
    out.push(`INSERT INTO audit_events(id,actor_id,action,subject_type,subject_id,details_json,created_at) SELECT ${sql(stableId("audit-doc", d.id))}, NULL, 'document.imported', 'document', ${sql(d.id)}, ${sql(JSON.stringify({ sha256: d.sha256, source: "legacy-inventory" }))}, ${sql(now)} WHERE NOT EXISTS (SELECT 1 FROM audit_events WHERE id = ${sql(stableId("audit-doc", d.id))});`);
  }
  for (const s of plan.stories) {
    const cols = { id: s.id, slug: s.slug, title: s.title, summary: s.summary ?? null, body: s.body, status: "draft", access_level: "public", kind: s.kind, category_id: s.category_id ?? null,
      jurisdiction_id: s.jurisdiction_id ?? null, video_url: s.video_url ?? null, current_version: 1, original_publisher: s.original_publisher ?? null, original_published_at: s.original_published_at ?? null,
      original_headline: s.original_headline ?? null, provenance_note: s.provenance, manuscript_state: s.manuscript_state || "imported", series_id: s.series ?? null, keywords: (s.keywords || []).join(", ") || null,
      legacy_ref: s.ref, created_at: now, updated_at: now };
    out.push(`INSERT OR IGNORE INTO articles(${Object.keys(cols).join(",")},author_id) VALUES (${Object.values(cols).map(sql).join(",")},${owner});`);
    out.push(`INSERT OR IGNORE INTO article_versions(id,article_id,version,title,summary,body,status,edited_by,note,created_at) VALUES (${[stableId("version", s.ref), s.id, 1, s.title, s.summary ?? null, s.body, "draft", null, s.decision === "import" ? "Imported from legacy manuscript" : "Inventory placeholder", now].map(sql).join(",")});`);
    for (const t of s.tags || []) {
      out.push(`INSERT OR IGNORE INTO tags(id,name) VALUES (${sql(slugify(t))},${sql(t)});`);
      out.push(`INSERT OR IGNORE INTO article_tags(article_id,tag_id) VALUES (${sql(s.id)},${sql(slugify(t))});`);
    }
    for (const docId of s.docIds) {
      out.push(`INSERT OR IGNORE INTO content_links(id,source_type,source_id,target_type,target_id,relationship,created_at) VALUES (${[stableId("link", `${s.ref}:${docId}`), "article", s.id, "document", docId, "evidence", now].map(sql).join(",")});`);
    }
    (s.citations || []).forEach((c, i) => {
      if (c.document_id && !s.docIds.includes(c.document_id)) return;
      out.push(`INSERT OR IGNORE INTO citations(id,subject_type,subject_id,label,url,document_id,pinpoint,note,sort_order,created_at) VALUES (${[stableId("citation", `${s.ref}:${i}`), "article", s.id, c.label, c.url ?? null, c.document_id ?? null, c.pinpoint ?? null, c.note ?? null, i + 1, now].map(sql).join(",")});`);
    });
    out.push(`INSERT INTO audit_events(id,actor_id,action,subject_type,subject_id,details_json,created_at) SELECT ${sql(stableId("audit-article", s.ref))}, NULL, ${sql(s.decision === "import" ? "article.imported" : "article.placeholder_created")}, 'article', ${sql(s.id)}, ${sql(JSON.stringify({ ref: s.ref, manuscript_state: s.manuscript_state || "imported" }))}, ${sql(now)} WHERE NOT EXISTS (SELECT 1 FROM audit_events WHERE id = ${sql(stableId("audit-article", s.ref))});`);
  }
  // Imported drafts created before any owner signed in have no author; attach them to the owner on a later run.
  out.push(`UPDATE articles SET author_id = ${owner} WHERE legacy_ref IS NOT NULL AND author_id IS NULL AND status = 'draft' AND EXISTS ${owner};`);
  return out.join("\n") + "\n";
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32", encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed:\n${r.stderr || r.stdout}`);
  return r.stdout;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const sourceRoot = opt("--source-root");
  const target = opt("--target");
  const dry = args.includes("--dry-run");
  if (!sourceRoot || !TARGETS[target]) {
    console.error("Usage: node scripts/editorial/import-legacy.mjs --source-root <dir> --target local|staging|production [--dry-run] [--confirm-production]");
    process.exit(2);
  }
  if (target === "production" && !dry && !args.includes("--confirm-production")) {
    console.error("Production import requires --confirm-production.");
    process.exit(2);
  }
  const inv = JSON.parse(readFileSync(join(HERE, "legacy-inventory.json"), "utf8"));
  const plan = buildPlan(inv, sourceRoot);
  if (plan.problems.length) { console.error("Refusing to import:\n- " + plan.problems.join("\n- ")); process.exit(1); }
  const summary = {
    target, documents: plan.docs.map((d) => ({ id: d.id, sha256: d.sha256, bytes: d.bytes })),
    imported: plan.stories.filter((s) => s.decision === "import").map((s) => ({ ref: s.ref, title: s.title, manuscript_state: s.manuscript_state, attached_documents: s.docIds.length })),
    placeholders: plan.stories.filter((s) => s.decision !== "import").map((s) => s.ref),
  };
  if (dry) { console.log(JSON.stringify(summary, null, 2)); return; }
  const t = TARGETS[target];
  const dir = mkdtempSync(join(tmpdir(), "forge-import-"));
  const file = join(dir, "import.sql");
  writeFileSync(file, planToSql(inv, plan));
  for (const d of plan.docs) run("npx", ["wrangler", "r2", "object", "put", `${t.r2Bucket}/${d.key}`, "--file", JSON.stringify(d.path), "--content-type", "application/pdf", ...t.r2]);
  run("npx", ["wrangler", "d1", "execute", "DB", ...t.d1, "--file", JSON.stringify(file), "--yes"]);
  console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) main().catch((e) => { console.error(e.message); process.exit(1); });
