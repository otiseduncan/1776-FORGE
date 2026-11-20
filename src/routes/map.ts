import type { Router, Ctx } from "../lib/context.ts";
import { HttpError, json } from "../lib/http.ts";
import { newId } from "../lib/crypto.ts";
import { can } from "../auth/permissions.ts";
import { geometry, httpsUrl, isoDate, num, oneOf, reqStr, str } from "../lib/validate.ts";
import { audit, citationsFor, discussionsFor, moderationEvent, notify, now, relatedContent, verifyTurnstile } from "../lib/store.ts";
import { readUpload } from "./records.ts";
import { filteredImportedMap, importedFeature, findImportedMap } from '../lib/imported-map.ts';

export const FEATURE_KINDS = ["road", "project", "facility", "boundary"] as const;
export const CONDITIONS = ["green", "yellow", "red", "gray"] as const;
export const REPORT_CATEGORIES = ["road_condition", "drainage", "safety", "construction", "public_property", "other"] as const;
const IMAGE_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

function featureToGeoJSON(row: Record<string, unknown>) {
  const { geometry_geojson, ...props } = row;
  return { type: "Feature", id: row.id, geometry: JSON.parse(String(geometry_geojson)), properties: props };
}

async function attachmentsFor(c: Ctx, ownerType: string, ownerId: string, viewerId: string | null, isMod: boolean) {
  const rows = await c.db.prepare("SELECT id, filename, mime_type, size, sha256, moderation_state, uploaded_by, created_at FROM attachments WHERE owner_type = ? AND owner_id = ? ORDER BY created_at")
    .bind(ownerType, ownerId).all<Record<string, string>>();
  return rows.results.filter((a) => a.moderation_state === "approved" || isMod || a.uploaded_by === viewerId)
    .map(({ uploaded_by: _u, ...a }) => ({ ...a, url: `/api/attachments/${a.id}` }));
}

export function registerMap(r: Router): void {
  r.get("/api/map/features", async (c) => {
    const where = ["f.verification_state != 'rejected'"];
    const args: unknown[] = [];
    const kinds = (c.url.searchParams.get("kind") || "").split(",").filter((k) => (FEATURE_KINDS as readonly string[]).includes(k));
    if (kinds.length) { where.push(`f.kind IN (${kinds.map(() => "?").join(",")})`); args.push(...kinds); }
    const j = c.url.searchParams.get("jurisdiction");
    if (j) { where.push("(f.jurisdiction_id = ? OR f.jurisdiction_id IN (SELECT id FROM jurisdictions WHERE parent_id = ?))"); args.push(j, j); }
    const county = c.url.searchParams.get('county');
    if (county) {
      if (county === '13009') { where.push("(f.jurisdiction_id='ga-baldwin' OR f.jurisdiction_id='ga-milledgeville')"); }
      else where.push('0=1');
    }
    const q = (c.url.searchParams.get('q') || '').trim().slice(0,160);
    for (const term of q.split(/\s+/).filter(Boolean)) {
      where.push("(f.title LIKE ? ESCAPE '\\' OR f.description LIKE ? ESCAPE '\\' OR f.properties_json LIKE ? ESCAPE '\\')");
      const p = '%' + term.replace(/[\\%_]/g, '\\$&') + '%'; args.push(p,p,p);
    }
    const cond = c.url.searchParams.get("condition");
    if (cond && (CONDITIONS as readonly string[]).includes(cond)) { where.push("f.condition_state = ?"); args.push(cond); }
    const rows = await c.db.prepare(
      `SELECT f.id, f.kind, f.title, f.description, f.geometry_geojson, f.condition_state, f.condition_note, f.condition_observed_at, f.status,
              f.verification_state, f.jurisdiction_id, j.name AS jurisdiction_name, f.updated_at
         FROM map_features f LEFT JOIN jurisdictions j ON j.id = f.jurisdiction_id WHERE ${where.join(" AND ")} ORDER BY f.kind, f.title LIMIT 2000`,
    ).bind(...args).all<Record<string, unknown>>();
    const imported = filteredImportedMap(c.url.searchParams).map(importedFeature);
    return json({ type: "FeatureCollection", features: [...rows.results.map(featureToGeoJSON), ...imported] }, 200, { "cache-control": "public, max-age=60" });
  });

  r.get("/api/map/features/:id", async (c) => {
    const imported = findImportedMap(c.params.id);
    if (imported) {
      const f = importedFeature(imported);
      return json({ feature: {...f.properties,geometry_geojson:JSON.stringify(f.geometry),properties:{legacy:imported}},
        citations:[],related:[],discussions:[],reports:[],attachments:[] });
    }
    const user = await c.user();
    const row = await c.db.prepare("SELECT f.*, j.name AS jurisdiction_name FROM map_features f LEFT JOIN jurisdictions j ON j.id = f.jurisdiction_id WHERE f.id = ?").bind(c.params.id).first<Record<string, unknown>>();
    if (!row) throw new HttpError(404, "Map feature not found");
    const [related, citations, discussions, reports, attachments] = await Promise.all([
      relatedContent(c, "map_feature", c.params.id),
      citationsFor(c, "map_feature", c.params.id),
      discussionsFor(c, "map_feature", c.params.id),
      c.db.prepare("SELECT r.id, r.title, r.description, r.category, r.created_at, u.display_name AS author FROM map_reports r LEFT JOIN users u ON u.id = r.author_id WHERE r.feature_id = ? AND r.review_state = 'approved' ORDER BY r.created_at DESC LIMIT 50").bind(c.params.id).all(),
      attachmentsFor(c, "map_feature", c.params.id, user?.id ?? null, can(user, "moderate")),
    ]);
    const { created_by: _cb, properties_json, ...feature } = row;
    return json({ feature: { ...feature, properties: properties_json ? JSON.parse(String(properties_json)) : {} }, related, citations, discussions, reports: reports.results, attachments });
  });

  r.post("/api/map/features", async (c) => {
    const user = await c.require("map.feature.write");
    const b = await c.body(1_000_000);
    const id = newId();
    const kind = oneOf(b, "kind", FEATURE_KINDS, { required: true })!;
    const geo = geometry(b);
    const condition = oneOf(b, "condition_state", CONDITIONS);
    const sourceUrl = httpsUrl(b, "source_url");
    const sourceDoc = str(b, "source_document_id", { max: 80 });
    // A condition rating is a factual claim: it must cite where it came from.
    if (condition && condition !== "gray" && !sourceUrl && !sourceDoc) throw new HttpError(422, "A road or project condition must cite a source URL or archived record");
    if (sourceDoc && !(await c.db.prepare("SELECT 1 FROM documents WHERE id = ?").bind(sourceDoc).first())) throw new HttpError(422, "Source record not found");
    const jurisdiction = str(b, "jurisdiction_id", { max: 80 });
    if (jurisdiction && !(await c.db.prepare("SELECT 1 FROM jurisdictions WHERE id = ?").bind(jurisdiction).first())) throw new HttpError(422, "Unknown jurisdiction");
    const props = b.properties && typeof b.properties === "object" && !Array.isArray(b.properties) ? JSON.stringify(b.properties).slice(0, 20_000) : null;
    const at = now();
    const stmts = [
      c.db.prepare(`INSERT INTO map_features(id,jurisdiction_id,kind,title,description,geometry_geojson,properties_json,condition_state,condition_note,condition_observed_at,status,verification_state,created_by,created_at,updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,'unreviewed',?,?,?)`)
        .bind(id, jurisdiction, kind, reqStr(b, "title", { max: 200 }), str(b, "description", { max: 4000 }), geo, props, condition, str(b, "condition_note", { max: 1000 }), isoDate(b, "condition_observed_at"), str(b, "status", { max: 80 }), user.id, at, at),
    ];
    if (sourceUrl || sourceDoc) {
      stmts.push(c.db.prepare("INSERT INTO citations(id,subject_type,subject_id,label,url,document_id,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)")
        .bind(newId(), "map_feature", id, str(b, "source_label", { max: 300 }) || "Source for condition rating", sourceUrl, sourceDoc, user.id, at));
    }
    await c.db.batch(stmts);
    await audit(c, user.id, "map_feature.created", "map_feature", id, { kind, condition });
    return json({ id }, 201);
  });

  r.patch("/api/map/features/:id", async (c) => {
    const user = await c.require("map.feature.write");
    const existing = await c.db.prepare("SELECT * FROM map_features WHERE id = ?").bind(c.params.id).first<Record<string, unknown>>();
    if (!existing) throw new HttpError(404, "Map feature not found");
    const b = await c.body(1_000_000);
    const sets: string[] = [];
    const args: unknown[] = [];
    const set = (col: string, v: unknown) => { sets.push(`${col} = ?`); args.push(v); };
    if ("title" in b) set("title", reqStr(b, "title", { max: 200 }));
    if ("description" in b) set("description", str(b, "description", { max: 4000 }));
    if ("geometry" in b) set("geometry_geojson", geometry(b));
    if ("status" in b) set("status", str(b, "status", { max: 80 }));
    if ("condition_state" in b) {
      const condition = oneOf(b, "condition_state", CONDITIONS);
      const sourceUrl = httpsUrl(b, "source_url");
      const sourceDoc = str(b, "source_document_id", { max: 80 });
      if (condition && condition !== "gray" && !sourceUrl && !sourceDoc) throw new HttpError(422, "A condition change must cite a source URL or archived record");
      set("condition_state", condition);
      set("condition_note", str(b, "condition_note", { max: 1000 }));
      set("condition_observed_at", isoDate(b, "condition_observed_at"));
      if (sourceUrl || sourceDoc) {
        await c.db.prepare("INSERT INTO citations(id,subject_type,subject_id,label,url,document_id,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)")
          .bind(newId(), "map_feature", c.params.id, str(b, "source_label", { max: 300 }) || `Condition source (${condition})`, sourceUrl, sourceDoc, user.id, now()).run();
      }
    }
    if ("verification_state" in b) {
      if (!can(user, "document.verify")) throw new HttpError(403, "Only editors may verify map features");
      set("verification_state", oneOf(b, "verification_state", ["unreviewed", "verified", "disputed", "rejected"] as const, { required: true }));
    }
    if (!sets.length) throw new HttpError(422, "No changes supplied");
    set("updated_at", now());
    await c.db.prepare(`UPDATE map_features SET ${sets.join(", ")} WHERE id = ?`).bind(...args, c.params.id).run();
    await audit(c, user.id, "map_feature.updated", "map_feature", c.params.id, { before: { condition: existing.condition_state, verification: existing.verification_state }, changes: Object.keys(b) });
    return json({ ok: true });
  });

  // ---- community problem reports (moderated)
  r.get("/api/map/reports", async (c) => {
    const user = await c.user();
    const mine = c.url.searchParams.get("mine") === "1" && user;
    const rows = mine
      ? await c.db.prepare("SELECT r.*, u.display_name AS author FROM map_reports r LEFT JOIN users u ON u.id = r.author_id WHERE r.author_id = ? ORDER BY r.created_at DESC LIMIT 100").bind(user!.id).all<Record<string, unknown>>()
      : await c.db.prepare("SELECT r.id, r.feature_id, r.title, r.description, r.category, r.lat, r.lng, r.review_state, r.created_at, u.display_name AS author FROM map_reports r LEFT JOIN users u ON u.id = r.author_id WHERE r.review_state = 'approved' AND r.lat IS NOT NULL ORDER BY r.created_at DESC LIMIT 1000").all<Record<string, unknown>>();
    return json({
      type: "FeatureCollection",
      features: rows.results.filter((x) => x.lat != null && x.lng != null).map((x) => {
        const { author_id: _a, reviewed_by: _rb, ...props } = x;
        return { type: "Feature", id: x.id, geometry: { type: "Point", coordinates: [x.lng, x.lat] }, properties: { ...props, kind: "report" } };
      }),
    });
  });

  r.post("/api/map/reports", async (c) => {
    const user = await c.require("map.report");
    const b = await c.body();
    await verifyTurnstile(c, b.turnstileToken);
    const lat = num(b, "lat", { required: true, min: -90, max: 90 })!;
    const lng = num(b, "lng", { required: true, min: -180, max: 180 })!;
    const feature = str(b, "feature_id", { max: 80 });
    if (feature && !(await c.db.prepare("SELECT 1 FROM map_features WHERE id = ?").bind(feature).first())) throw new HttpError(422, "Map feature not found");
    const recent = await c.db.prepare("SELECT COUNT(*) AS n FROM map_reports WHERE author_id = ? AND created_at > ?").bind(user.id, new Date(Date.now() - 3600_000).toISOString()).first<{ n: number }>();
    if ((recent?.n ?? 0) >= 5) throw new HttpError(429, "You have submitted several reports in the last hour. Please wait before submitting more.");
    const id = newId();
    await c.db.prepare("INSERT INTO map_reports(id,feature_id,author_id,title,description,category,lat,lng,jurisdiction_id,review_state,created_at) VALUES (?,?,?,?,?,?,?,?,?,'pending',?)")
      .bind(id, feature, user.id, reqStr(b, "title", { max: 160, min: 4 }), reqStr(b, "description", { max: 4000, min: 10 }), oneOf(b, "category", REPORT_CATEGORIES, { fallback: "other" }), lat, lng, str(b, "jurisdiction_id", { max: 80 }), now()).run();
    await audit(c, user.id, "map_report.submitted", "map_report", id);
    return json({ id, review_state: "pending" }, 201);
  });

  r.post("/api/map/reports/:id/attachments", async (c) => {
    const user = await c.require("map.report");
    const report = await c.db.prepare("SELECT author_id FROM map_reports WHERE id = ?").bind(c.params.id).first<{ author_id: string }>();
    if (!report) throw new HttpError(404, "Report not found");
    if (report.author_id !== user.id && !can(user, "moderate")) throw new HttpError(403, "Only the report author may attach evidence");
    const count = await c.db.prepare("SELECT COUNT(*) AS n FROM attachments WHERE owner_type='map_report' AND owner_id = ?").bind(c.params.id).first<{ n: number }>();
    if ((count?.n ?? 0) >= 6) throw new HttpError(409, "A report can have at most 6 attachments");
    const up = await readUpload(c, [...IMAGE_MIME, "application/pdf"], 10 * 1024 * 1024);
    const id = newId();
    const key = `attachments/map_report/${c.params.id}/${id}-${up.filename}`;
    await c.bucket.put(key, up.bytes, { httpMetadata: { contentType: up.mime }, customMetadata: { sha256: up.sha256, uploadedBy: user.id } });
    await c.db.prepare("INSERT INTO attachments(id,owner_type,owner_id,storage_key,filename,mime_type,size,sha256,uploaded_by,moderation_state,created_at) VALUES (?,?,?,?,?,?,?,?,?,'pending',?)")
      .bind(id, "map_report", c.params.id, key, up.filename, up.mime, up.bytes.byteLength, up.sha256, user.id, now()).run();
    await audit(c, user.id, "attachment.uploaded", "map_report", c.params.id, { attachment: id, sha256: up.sha256 });
    return json({ id, moderation_state: "pending" }, 201);
  });

  r.get("/api/map/reports/:id", async (c) => {
    const user = await c.user();
    const row = await c.db.prepare("SELECT r.*, u.display_name AS author FROM map_reports r LEFT JOIN users u ON u.id = r.author_id WHERE r.id = ?").bind(c.params.id).first<Record<string, unknown>>();
    if (!row) throw new HttpError(404, "Report not found");
    const isMod = can(user, "moderate");
    if (row.review_state !== "approved" && !isMod && row.author_id !== user?.id) throw new HttpError(404, "Report not found");
    const { author_id: _a, reviewed_by: _r, ...report } = row;
    return json({ report, attachments: await attachmentsFor(c, "map_report", c.params.id, user?.id ?? null, isMod), discussions: await discussionsFor(c, "map_report", c.params.id) });
  });

  r.post("/api/map/reports/:id/review", async (c) => {
    const user = await c.require("moderate");
    const b = await c.body();
    const decision = oneOf(b, "decision", ["approved", "rejected"] as const, { required: true })!;
    const note = str(b, "note", { max: 1000 });
    if (decision === "rejected" && !note) throw new HttpError(422, "A reason is required when rejecting a report");
    const report = await c.db.prepare("SELECT author_id, title FROM map_reports WHERE id = ?").bind(c.params.id).first<{ author_id: string; title: string }>();
    if (!report) throw new HttpError(404, "Report not found");
    await c.db.batch([
      c.db.prepare("UPDATE map_reports SET review_state = ?, reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?").bind(decision, user.id, now(), note, c.params.id),
      c.db.prepare("UPDATE attachments SET moderation_state = ? WHERE owner_type = 'map_report' AND owner_id = ? AND moderation_state = 'pending'").bind(decision === "approved" ? "approved" : "rejected", c.params.id),
    ]);
    await moderationEvent(c, user.id, "map_report", c.params.id, decision === "approved" ? "approve" : "reject", note);
    await notify(c, [report.author_id], "report_reviewed", "map_report", c.params.id, `Your map report “${report.title}” was ${decision}.${note ? " Note: " + note : ""}`, `/map?report=${c.params.id}`);
    return json({ ok: true });
  });

  r.get("/api/attachments/:id", async (c) => {
    const user = await c.user();
    const a = await c.db.prepare("SELECT * FROM attachments WHERE id = ?").bind(c.params.id).first<Record<string, string>>();
    if (!a) throw new HttpError(404, "Attachment not found");
    if (a.moderation_state !== "approved" && !can(user, "moderate") && a.uploaded_by !== user?.id) throw new HttpError(404, "Attachment not found");
    const obj = await c.bucket.get(a.storage_key);
    if (!obj) throw new HttpError(404, "Stored file missing");
    return new Response(obj.body, { headers: { "content-type": a.mime_type, "content-disposition": `inline; filename="${a.filename.replace(/"/g, "")}"`, "x-content-type-options": "nosniff", "cache-control": a.moderation_state === "approved" ? "public, max-age=3600" : "private, no-store" } });
  });
}
