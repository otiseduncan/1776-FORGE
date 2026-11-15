import type { Router } from "../lib/context.ts";
import { HttpError, json } from "../lib/http.ts";
import { newId } from "../lib/crypto.ts";
import { httpsUrl, oneOf, reqStr, str } from "../lib/validate.ts";
import { audit, entityExists, now } from "../lib/store.ts";

export const LINKABLE = ["document", "article", "map_feature", "legal", "meeting", "motion", "budget", "financial_report", "resource"] as const;
export const RELATIONSHIPS = ["related", "cites", "supports", "contradicts", "supersedes", "responds_to", "interprets", "commentary", "evidence", "attachment_of", "about"] as const;
export const CITABLE = ["article", "document", "map_feature", "legal", "meeting", "budget"] as const;

export function registerLinks(r: Router): void {
  r.post("/api/links", async (c) => {
    const user = await c.require("links.write");
    const b = await c.body();
    const sourceType = oneOf(b, "source_type", LINKABLE, { required: true })!;
    const targetType = oneOf(b, "target_type", LINKABLE, { required: true })!;
    const sourceId = reqStr(b, "source_id", { max: 80 });
    const targetId = reqStr(b, "target_id", { max: 80 });
    const relationship = oneOf(b, "relationship", RELATIONSHIPS, { fallback: "related" })!;
    if (sourceType === targetType && sourceId === targetId) throw new HttpError(422, "An item cannot be linked to itself");
    await entityExists(c, sourceType, sourceId);
    await entityExists(c, targetType, targetId);
    const id = newId();
    const res = await c.db.prepare("INSERT OR IGNORE INTO content_links(id,source_type,source_id,target_type,target_id,relationship,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)")
      .bind(id, sourceType, sourceId, targetType, targetId, relationship, user.id, now()).run();
    if (!res.meta.changes) throw new HttpError(409, "These items are already linked with that relationship");
    await audit(c, user.id, "link.created", sourceType, sourceId, { targetType, targetId, relationship });
    return json({ id }, 201);
  });

  r.delete("/api/links/:id", async (c) => {
    const user = await c.require("links.write");
    const row = await c.db.prepare("SELECT * FROM content_links WHERE id = ?").bind(c.params.id).first<Record<string, string>>();
    if (!row) throw new HttpError(404, "Link not found");
    if (row.created_by !== user.id) await c.require("document.verify");
    await c.db.prepare("DELETE FROM content_links WHERE id = ?").bind(c.params.id).run();
    await audit(c, user.id, "link.deleted", row.source_type, row.source_id, row);
    return json({ ok: true });
  });

  r.post("/api/citations", async (c) => {
    const user = await c.require("links.write");
    const b = await c.body();
    const subjectType = oneOf(b, "subject_type", CITABLE, { required: true })!;
    const subjectId = reqStr(b, "subject_id", { max: 80 });
    const subject = await entityExists(c, subjectType, subjectId);
    if (subjectType === "article" && subject.author_id !== user.id) await c.require("article.publish");
    const url = httpsUrl(b, "url");
    const documentId = str(b, "document_id", { max: 80 });
    if (!url && !documentId) throw new HttpError(422, "A citation needs a source URL or a record in the archive");
    if (documentId) await entityExists(c, "document", documentId);
    const id = newId();
    await c.db.prepare("INSERT INTO citations(id,subject_type,subject_id,label,url,document_id,pinpoint,note,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(id, subjectType, subjectId, reqStr(b, "label", { max: 300 }), url, documentId, str(b, "pinpoint", { max: 120 }), str(b, "note", { max: 1000 }), user.id, now()).run();
    await audit(c, user.id, "citation.created", subjectType, subjectId, { id, url, documentId });
    return json({ id }, 201);
  });

  r.delete("/api/citations/:id", async (c) => {
    const user = await c.require("links.write");
    const row = await c.db.prepare("SELECT * FROM citations WHERE id = ?").bind(c.params.id).first<Record<string, string>>();
    if (!row) throw new HttpError(404, "Citation not found");
    if (row.created_by !== user.id) await c.require("document.verify");
    await c.db.prepare("DELETE FROM citations WHERE id = ?").bind(c.params.id).run();
    await audit(c, user.id, "citation.deleted", row.subject_type, row.subject_id, row);
    return json({ ok: true });
  });
}
