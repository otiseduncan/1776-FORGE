import type { Router, Ctx } from "../lib/context.ts";
import { HttpError, json, pageParams, publicJson } from "../lib/http.ts";
import { newId, sha256Hex } from "../lib/crypto.ts";
import { can } from "../auth/permissions.ts";
import { cleanQuery, httpsUrl, isoDate, likePattern, oneOf, reqStr, str } from "../lib/validate.ts";
import { audit, citationsFor, discussionsFor, now, relatedContent } from "../lib/store.ts";

export const VERIFICATION_STATES = ["unreviewed", "verified", "disputed", "superseded"] as const;
export const SOURCE_KINDS = ["official", "open_records_response", "court", "third_party", "community"] as const;
export const DOC_MIME = ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif", "text/plain", "text/csv"] as const;
export const MAX_DOC_BYTES = 50 * 1024 * 1024;

function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() || "file";
  return base.replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, "_").slice(0, 120) || "file";
}

/** Sniff the leading bytes so a mislabeled upload cannot be served under a different type. */
export function sniffMime(bytes: Uint8Array, declared: string): string | null {
  const starts = (sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts([0x25, 0x50, 0x44, 0x46])) return "application/pdf";
  if (starts([0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts([0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (starts([0x52, 0x49, 0x46, 0x46]) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  if (declared === "text/plain" || declared === "text/csv") {
    const sample = bytes.subarray(0, 2048);
    if (!sample.some((b) => b === 0)) return declared;
  }
  return null;
}

export async function readUpload(c: Ctx, allowed: readonly string[], maxBytes: number): Promise<{ bytes: Uint8Array; mime: string; filename: string; sha256: string }> {
  const type = c.req.headers.get("content-type") || "";
  if (!type.includes("multipart/form-data")) throw new HttpError(415, "Upload must be multipart/form-data");
  const len = Number(c.req.headers.get("content-length") || 0);
  if (len > maxBytes + 64_000) throw new HttpError(413, `File exceeds the ${Math.round(maxBytes / 1048576)} MB limit`);
  const form = await c.req.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") throw new HttpError(422, "A file is required");
  const blob = file as File;
  if (blob.size === 0) throw new HttpError(422, "The file is empty");
  if (blob.size > maxBytes) throw new HttpError(413, `File exceeds the ${Math.round(maxBytes / 1048576)} MB limit`);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const mime = sniffMime(bytes, blob.type);
  if (!mime || !allowed.includes(mime)) throw new HttpError(415, `Unsupported file type. Allowed: ${allowed.join(", ")}`);
  return { bytes, mime, filename: safeFilename(blob.name || "upload"), sha256: await sha256Hex(bytes) };
}

const DOC_SELECT = `SELECT d.id, d.title, d.document_type, d.category_id, dc.name AS category_name, d.summary, d.record_date, d.published_date,
  d.source_url, d.source_kind, d.citation, d.verification_state, d.mime_type, d.file_size, d.original_filename, d.original_sha256,
  d.jurisdiction_id, j.name AS jurisdiction_name, j.level AS jurisdiction_level, d.agency_id, a.name AS agency_name,
  d.imported_legacy_id, d.created_at, d.updated_at, d.verified_at, d.integrity_state, d.integrity_checked_at,
  CASE WHEN d.original_storage_key IS NOT NULL THEN 1 ELSE 0 END AS has_file
  FROM documents d
  LEFT JOIN jurisdictions j ON j.id = d.jurisdiction_id
  LEFT JOIN agencies a ON a.id = d.agency_id
  LEFT JOIN document_categories dc ON dc.id = d.category_id`;

async function loadDoc(c: Ctx, id: string, allowPrivate: boolean) {
  const doc = await c.db.prepare(`${DOC_SELECT} WHERE d.id = ?`).bind(id).first<Record<string, unknown> & { visibility?: string }>();
  if (!doc) throw new HttpError(404, "Record not found");
  const vis = await c.db.prepare("SELECT visibility, created_by FROM documents WHERE id = ?").bind(id).first<{ visibility: string; created_by: string | null }>();
  if (vis?.visibility !== "public" && !allowPrivate) throw new HttpError(404, "Record not found");
  return { doc, visibility: vis?.visibility, created_by: vis?.created_by };
}

export function registerRecords(r: Router): void {
  r.get("/api/records/facets", async (c) => {
    const [cats, juris, agencies, states] = await Promise.all([
      c.db.prepare("SELECT dc.id, dc.name, COUNT(d.id) AS n FROM document_categories dc LEFT JOIN documents d ON d.category_id = dc.id AND d.visibility='public' GROUP BY dc.id ORDER BY dc.sort_order").all(),
      c.db.prepare("SELECT j.id, j.name, j.level, j.parent_id, COUNT(d.id) AS n FROM jurisdictions j LEFT JOIN documents d ON d.jurisdiction_id = j.id AND d.visibility='public' GROUP BY j.id ORDER BY CASE j.level WHEN 'federal' THEN 1 WHEN 'state' THEN 2 WHEN 'county' THEN 3 ELSE 4 END, j.name").all(),
      c.db.prepare("SELECT a.id, a.name, a.jurisdiction_id FROM agencies a ORDER BY a.name LIMIT 500").all(),
      c.db.prepare("SELECT verification_state AS id, COUNT(*) AS n FROM documents WHERE visibility='public' GROUP BY verification_state").all(),
    ]);
    return publicJson({ categories: cats.results, jurisdictions: juris.results, agencies: agencies.results, verification: states.results }, 60);
  });

  r.get("/api/records", async (c) => {
    const { page, size, offset } = pageParams(c.url, 20, 50);
    const where: string[] = ["d.visibility = 'public'"];
    const args: unknown[] = [];
    const q = cleanQuery(c.url);
    if (q) {
      where.push("(d.title LIKE ? ESCAPE '\\' OR d.summary LIKE ? ESCAPE '\\' OR d.citation LIKE ? ESCAPE '\\' OR a.name LIKE ? ESCAPE '\\' OR j.name LIKE ? ESCAPE '\\')");
      const p = likePattern(q);
      args.push(p, p, p, p, p);
    }
    const level = c.url.searchParams.get("level");
    if (level) {
      if (!["federal", "state", "county", "city", "other"].includes(level)) throw new HttpError(422, "Unknown level");
      where.push("j.level = ?"); args.push(level);
    }
    for (const [param, col] of [["jurisdiction", "d.jurisdiction_id"], ["agency", "d.agency_id"], ["category", "d.category_id"], ["verification", "d.verification_state"], ["type", "d.document_type"]] as const) {
      const v = c.url.searchParams.get(param);
      if (v) { where.push(`${col} = ?`); args.push(v.slice(0, 80)); }
    }
    const from = c.url.searchParams.get("from");
    const to = c.url.searchParams.get("to");
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) { where.push("d.record_date >= ?"); args.push(from); }
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) { where.push("d.record_date <= ?"); args.push(to); }
    const sort = c.url.searchParams.get("sort") === "added" ? "d.created_at DESC" : c.url.searchParams.get("sort") === "title" ? "d.title COLLATE NOCASE" : "d.record_date DESC NULLS LAST, d.created_at DESC";
    const whereSql = " WHERE " + where.join(" AND ");
    const total = await c.db.prepare(`SELECT COUNT(*) AS n FROM documents d LEFT JOIN jurisdictions j ON j.id = d.jurisdiction_id LEFT JOIN agencies a ON a.id = d.agency_id${whereSql}`).bind(...args).first<{ n: number }>();
    const rows = await c.db.prepare(`${DOC_SELECT}${whereSql} ORDER BY ${sort} LIMIT ? OFFSET ?`).bind(...args, size, offset).all();
    return json({ items: rows.results, total: total?.n ?? 0, page, pageSize: size });
  });

  r.get("/api/records/:id", async (c) => {
    const user = await c.user();
    const { doc, created_by } = await loadDoc(c, c.params.id, can(user, "document.create"));
    const [related, citations, discussions, meetings, duplicates] = await Promise.all([
      relatedContent(c, "document", c.params.id),
      citationsFor(c, "document", c.params.id),
      discussionsFor(c, "document", c.params.id),
      c.db.prepare(`SELECT m.id, m.title, m.meeting_date FROM meetings m WHERE m.agenda_document_id = ?1 OR m.minutes_document_id = ?1 OR m.transcript_document_id = ?1`).bind(c.params.id).all(),
      doc.original_sha256
        ? c.db.prepare("SELECT id, title FROM documents WHERE original_sha256 = ? AND id != ? AND visibility='public'").bind(doc.original_sha256, c.params.id).all()
        : Promise.resolve({ results: [] }),
    ]);
    const canEdit = !!user && (can(user, "document.verify") || (can(user, "document.create") && created_by === user.id));
    return json({ document: doc, related, citations, discussions, meetings: meetings.results, duplicates: duplicates.results, permissions: { edit: canEdit, verify: can(user, "document.verify") } });
  });

  r.post("/api/records", async (c) => {
    const user = await c.require("document.create");
    const b = await c.body();
    const title = reqStr(b, "title", { max: 300, min: 3 });
    const category = str(b, "category_id", { max: 40 });
    if (category && !(await c.db.prepare("SELECT 1 FROM document_categories WHERE id = ?").bind(category).first())) throw new HttpError(422, "Unknown category");
    const jurisdiction = str(b, "jurisdiction_id", { max: 80 });
    if (jurisdiction && !(await c.db.prepare("SELECT 1 FROM jurisdictions WHERE id = ?").bind(jurisdiction).first())) throw new HttpError(422, "Unknown jurisdiction");
    const agency = str(b, "agency_id", { max: 80 });
    if (agency && !(await c.db.prepare("SELECT 1 FROM agencies WHERE id = ?").bind(agency).first())) throw new HttpError(422, "Unknown agency");
    const sourceUrl = httpsUrl(b, "source_url");
    const recordDate = isoDate(b, "record_date");
    const doc = {
      id: newId(), title, category, jurisdiction, agency, sourceUrl, recordDate,
      type: str(b, "document_type", { max: 80 }) || category || "record",
      summary: str(b, "summary", { max: 4000 }),
      citation: str(b, "citation", { max: 300 }),
      published: isoDate(b, "published_date"),
      sourceKind: oneOf(b, "source_kind", SOURCE_KINDS, { fallback: "official" }),
      visibility: oneOf(b, "visibility", ["public", "staff"] as const, { fallback: "public" }),
    };
    if (b.force !== true) {
      const dup = await c.db.prepare(
        `SELECT id, title FROM documents WHERE (source_url IS NOT NULL AND source_url = ?) OR (lower(title) = lower(?) AND IFNULL(record_date,'') = IFNULL(?,'') AND IFNULL(jurisdiction_id,'') = IFNULL(?,'')) LIMIT 5`,
      ).bind(sourceUrl, title, recordDate, jurisdiction).all();
      if (dup.results.length) throw new HttpError(409, "A record with the same source URL or the same title, date and jurisdiction already exists", { duplicates: dup.results });
    }
    const at = now();
    await c.db.prepare(
      `INSERT INTO documents(id,jurisdiction_id,agency_id,title,document_type,category_id,summary,citation,record_date,published_date,source_url,source_kind,verification_state,visibility,created_by,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'unreviewed',?,?,?,?)`,
    ).bind(doc.id, jurisdiction, agency, title, doc.type, category, doc.summary, doc.citation, recordDate, doc.published, sourceUrl, doc.sourceKind, doc.visibility, user.id, at, at).run();
    await audit(c, user.id, "document.created", "document", doc.id, { title, sourceUrl });
    return json({ id: doc.id }, 201);
  });

  r.patch("/api/records/:id", async (c) => {
    const user = await c.require("document.create");
    const { created_by } = await loadDoc(c, c.params.id, true);
    const isEditor = can(user, "document.verify");
    if (!isEditor && created_by !== user.id) throw new HttpError(403, "Only the submitting researcher or an editor may edit this record");
    const b = await c.body();
    const sets: string[] = [];
    const args: unknown[] = [];
    const set = (col: string, v: unknown) => { sets.push(`${col} = ?`); args.push(v); };
    if ("title" in b) set("title", reqStr(b, "title", { max: 300, min: 3 }));
    if ("summary" in b) set("summary", str(b, "summary", { max: 4000 }));
    if ("citation" in b) set("citation", str(b, "citation", { max: 300 }));
    if ("record_date" in b) set("record_date", isoDate(b, "record_date"));
    if ("published_date" in b) set("published_date", isoDate(b, "published_date"));
    if ("source_url" in b) set("source_url", httpsUrl(b, "source_url"));
    if ("category_id" in b) set("category_id", str(b, "category_id", { max: 40 }));
    if ("jurisdiction_id" in b) set("jurisdiction_id", str(b, "jurisdiction_id", { max: 80 }));
    if ("agency_id" in b) set("agency_id", str(b, "agency_id", { max: 80 }));
    if ("source_kind" in b) set("source_kind", oneOf(b, "source_kind", SOURCE_KINDS, { required: true }));
    if ("visibility" in b) set("visibility", oneOf(b, "visibility", ["public", "staff"] as const, { required: true }));
    if ("verification_state" in b) {
      if (!isEditor) throw new HttpError(403, "Only editors may change verification status");
      set("verification_state", oneOf(b, "verification_state", VERIFICATION_STATES, { required: true }));
      set("verified_by", user.id);
      set("verified_at", now());
    }
    if (!sets.length) throw new HttpError(422, "No changes supplied");
    set("updated_at", now());
    await c.db.prepare(`UPDATE documents SET ${sets.join(", ")} WHERE id = ?`).bind(...args, c.params.id).run();
    await audit(c, user.id, "verification_state" in b ? "document.verification_changed" : "document.updated", "document", c.params.id, b);
    return json({ ok: true });
  });

  r.post("/api/records/:id/file", async (c) => {
    const user = await c.require("document.create");
    const { doc, created_by } = await loadDoc(c, c.params.id, true);
    if (!can(user, "document.verify") && created_by !== user.id) throw new HttpError(403, "Only the submitting researcher or an editor may attach the original file");
    if (doc.has_file) throw new HttpError(409, "This record already has an original file. Originals are immutable; create a new record for a new version and link it as 'supersedes'.");
    const bucket = c.bucket;
    const up = await readUpload(c, DOC_MIME, MAX_DOC_BYTES);
    const dup = await c.db.prepare("SELECT id, title FROM documents WHERE original_sha256 = ?").bind(up.sha256).first<{ id: string; title: string }>();
    if (dup) throw new HttpError(409, "This exact file is already stored on another record", { duplicates: [dup] });
    const key = `documents/${new Date().getUTCFullYear()}/${c.params.id}/${up.filename}`;
    await bucket.put(key, up.bytes, {
      httpMetadata: { contentType: up.mime },
      customMetadata: { sha256: up.sha256, documentId: c.params.id, uploadedBy: user.id },
      sha256: up.sha256,
    });
    await c.db.prepare("UPDATE documents SET original_storage_key = ?, original_sha256 = ?, mime_type = ?, file_size = ?, original_filename = ?, integrity_state = 'ok', integrity_checked_at = ?, updated_at = ? WHERE id = ?")
      .bind(key, up.sha256, up.mime, up.bytes.byteLength, up.filename, now(), now(), c.params.id).run();
    await audit(c, user.id, "document.file_attached", "document", c.params.id, { sha256: up.sha256, size: up.bytes.byteLength, mime: up.mime });
    return json({ ok: true, sha256: up.sha256, size: up.bytes.byteLength, mime_type: up.mime }, 201);
  });

  r.get("/api/records/:id/file", async (c) => {
    const user = await c.user();
    await loadDoc(c, c.params.id, can(user, "document.create"));
    const row = await c.db.prepare("SELECT original_storage_key, mime_type, original_filename, original_sha256 FROM documents WHERE id = ?").bind(c.params.id).first<Record<string, string>>();
    if (!row?.original_storage_key) throw new HttpError(404, "No original file is stored for this record");
    const obj = await c.bucket.get(row.original_storage_key);
    if (!obj) throw new HttpError(404, "The stored file could not be found");
    const download = c.url.searchParams.get("download") === "1";
    const headers = new Headers({
      "content-type": row.mime_type || "application/octet-stream",
      "content-disposition": `${download ? "attachment" : "inline"}; filename="${(row.original_filename || "document").replace(/"/g, "")}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "public, max-age=3600",
      "x-forge-sha256": row.original_sha256 || "",
      // Allow the record page on this origin to embed the PDF preview; nothing else may frame it.
      "x-frame-options": "SAMEORIGIN",
      "content-security-policy": row.mime_type?.startsWith("text/") ? "default-src 'none'; frame-ancestors 'self'" : "frame-ancestors 'self'",
    });
    return new Response(obj.body, { headers });
  });

  r.post("/api/records/:id/integrity", async (c) => {
    const user = await c.require("document.verify");
    const row = await c.db.prepare("SELECT original_storage_key, original_sha256 FROM documents WHERE id = ?").bind(c.params.id).first<Record<string, string>>();
    if (!row) throw new HttpError(404, "Record not found");
    if (!row.original_storage_key) throw new HttpError(409, "No original file is stored for this record");
    const obj = await c.bucket.get(row.original_storage_key);
    let state = "missing";
    let actual: string | null = null;
    if (obj) {
      actual = await sha256Hex(new Uint8Array(await obj.arrayBuffer()));
      state = actual === row.original_sha256 ? "ok" : "mismatch";
    }
    await c.db.prepare("UPDATE documents SET integrity_state = ?, integrity_checked_at = ? WHERE id = ?").bind(state, now(), c.params.id).run();
    await audit(c, user.id, "document.integrity_checked", "document", c.params.id, { state, expected: row.original_sha256, actual });
    return json({ state, expected: row.original_sha256, actual });
  });

  // ---- jurisdictions & agencies
  r.get("/api/jurisdictions", async (c) => {
    const rows = await c.db.prepare(
      `SELECT j.id, j.name, j.level, j.parent_id, j.state_code,
        (SELECT COUNT(*) FROM documents d WHERE d.jurisdiction_id = j.id AND d.visibility='public') AS documents,
        (SELECT COUNT(*) FROM map_features f WHERE f.jurisdiction_id = j.id) AS map_features,
        (SELECT COUNT(*) FROM governing_bodies g WHERE g.jurisdiction_id = j.id) AS bodies,
        (SELECT COUNT(*) FROM resource_links rl WHERE rl.jurisdiction_id = j.id AND rl.status != 'disabled') AS resources
       FROM jurisdictions j ORDER BY CASE j.level WHEN 'federal' THEN 1 WHEN 'state' THEN 2 WHEN 'county' THEN 3 WHEN 'city' THEN 4 ELSE 5 END, j.name`,
    ).all();
    return publicJson({ items: rows.results }, 120);
  });

  r.get("/api/jurisdictions/:id", async (c) => {
    const j = await c.db.prepare("SELECT * FROM jurisdictions WHERE id = ?").bind(c.params.id).first();
    if (!j) throw new HttpError(404, "Jurisdiction not found");
    const [children, parent, agencies, bodies, docs, resources, features, articles] = await Promise.all([
      c.db.prepare("SELECT id, name, level FROM jurisdictions WHERE parent_id = ? ORDER BY name").bind(c.params.id).all(),
      c.db.prepare("SELECT id, name, level FROM jurisdictions WHERE id = (SELECT parent_id FROM jurisdictions WHERE id = ?)").bind(c.params.id).first(),
      c.db.prepare("SELECT id, name, official_url FROM agencies WHERE jurisdiction_id = ? ORDER BY name").bind(c.params.id).all(),
      c.db.prepare("SELECT id, name, official_url FROM governing_bodies WHERE jurisdiction_id = ? ORDER BY name").bind(c.params.id).all(),
      c.db.prepare(`${DOC_SELECT} WHERE d.jurisdiction_id = ? AND d.visibility='public' ORDER BY d.record_date DESC LIMIT 10`).bind(c.params.id).all(),
      c.db.prepare("SELECT id, name, url, description, status FROM resource_links WHERE jurisdiction_id = ? AND status != 'disabled' ORDER BY name").bind(c.params.id).all(),
      c.db.prepare("SELECT COUNT(*) AS n FROM map_features WHERE jurisdiction_id = ?").bind(c.params.id).first<{ n: number }>(),
      c.db.prepare("SELECT id, slug, title, summary, published_at FROM articles WHERE jurisdiction_id = ? AND status='published' ORDER BY published_at DESC LIMIT 6").bind(c.params.id).all(),
    ]);
    return json({ jurisdiction: j, parent, children: children.results, agencies: agencies.results, bodies: bodies.results, documents: docs.results, resources: resources.results, mapFeatures: features?.n ?? 0, articles: articles.results });
  });

  r.post("/api/jurisdictions", async (c) => {
    const user = await c.require("jurisdiction.write");
    const b = await c.body();
    const name = reqStr(b, "name", { max: 120 });
    const level = oneOf(b, "level", ["federal", "state", "county", "city", "other"] as const, { required: true })!;
    const parent = str(b, "parent_id", { max: 80 });
    if (parent && !(await c.db.prepare("SELECT 1 FROM jurisdictions WHERE id = ?").bind(parent).first())) throw new HttpError(422, "Unknown parent jurisdiction");
    const id = (str(b, "id", { max: 80 }) || name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (await c.db.prepare("SELECT 1 FROM jurisdictions WHERE id = ?").bind(id).first()) throw new HttpError(409, "A jurisdiction with this identifier already exists");
    await c.db.prepare("INSERT INTO jurisdictions(id,name,level,parent_id,state_code,created_at) VALUES (?,?,?,?,?,?)").bind(id, name, level, parent, str(b, "state_code", { max: 2 }), now()).run();
    await audit(c, user.id, "jurisdiction.created", "jurisdiction", id, { name, level });
    return json({ id }, 201);
  });

  r.get("/api/agencies", async (c) => {
    const j = c.url.searchParams.get("jurisdiction");
    const stmt = j ? c.db.prepare("SELECT * FROM agencies WHERE jurisdiction_id = ? ORDER BY name").bind(j) : c.db.prepare("SELECT * FROM agencies ORDER BY name LIMIT 500");
    return publicJson({ items: (await stmt.all()).results }, 120);
  });

  r.post("/api/agencies", async (c) => {
    const user = await c.require("document.create");
    const b = await c.body();
    const jurisdiction = reqStr(b, "jurisdiction_id", { max: 80 });
    if (!(await c.db.prepare("SELECT 1 FROM jurisdictions WHERE id = ?").bind(jurisdiction).first())) throw new HttpError(422, "Unknown jurisdiction");
    const name = reqStr(b, "name", { max: 160 });
    if (await c.db.prepare("SELECT 1 FROM agencies WHERE jurisdiction_id = ? AND lower(name) = lower(?)").bind(jurisdiction, name).first()) throw new HttpError(409, "This agency already exists in that jurisdiction");
    const id = newId();
    await c.db.prepare("INSERT INTO agencies(id,jurisdiction_id,name,official_url,created_at) VALUES (?,?,?,?,?)").bind(id, jurisdiction, name, httpsUrl(b, "official_url"), now()).run();
    await audit(c, user.id, "agency.created", "agency", id, { name, jurisdiction });
    return json({ id }, 201);
  });
}
