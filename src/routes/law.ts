import type { Router } from "../lib/context.ts";
import { HttpError, json, publicJson } from "../lib/http.ts";
import { newId } from "../lib/crypto.ts";
import { can } from "../auth/permissions.ts";
import { cleanQuery, httpsUrl, isoDate, likePattern, oneOf, reqStr, str } from "../lib/validate.ts";
import { audit, citationsFor, discussionsFor, now, relatedContent } from "../lib/store.ts";

export const LEGAL_CATEGORIES = ["founding", "constitution", "amendment", "federal_statute", "federal_case", "state_constitution", "state_statute", "state_case"] as const;
export const TEXT_KINDS = ["original_text", "current_authority", "historical_version", "judicial_interpretation"] as const;
export const LEGAL_STATUS = ["in_force", "repealed", "superseded", "historical", "overruled"] as const;

const FIELDS = `l.id, l.title, l.short_title, l.authority_type, l.category, l.jurisdiction_id, j.name AS jurisdiction_name, l.citation, l.enacted_at, l.effective_at,
  l.repealed_at, l.status, l.text_kind, l.source_url, l.annotated_url, l.summary, l.version_label, l.court, l.decided_at, l.sort_order,
  CASE WHEN l.body_text IS NOT NULL THEN 1 ELSE 0 END AS has_text`;

export function registerLaw(r: Router): void {
  r.get("/api/law", async (c) => {
    const where: string[] = [];
    const args: unknown[] = [];
    const cat = c.url.searchParams.get("category");
    if (cat) { where.push("l.category = ?"); args.push(cat); }
    const j = c.url.searchParams.get("jurisdiction");
    if (j) { where.push("l.jurisdiction_id = ?"); args.push(j); }
    const q = cleanQuery(c.url);
    if (q) { where.push("(l.title LIKE ? ESCAPE '\\' OR l.citation LIKE ? ESCAPE '\\' OR l.summary LIKE ? ESCAPE '\\' OR l.short_title LIKE ? ESCAPE '\\')"); const p = likePattern(q); args.push(p, p, p, p); }
    const rows = await c.db.prepare(`SELECT ${FIELDS} FROM legal_authorities l LEFT JOIN jurisdictions j ON j.id = l.jurisdiction_id ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY l.sort_order, l.title LIMIT 500`).bind(...args).all();
    return publicJson({ items: rows.results }, 300);
  });

  r.get("/api/law/:id", async (c) => {
    const row = await c.db.prepare(`SELECT ${FIELDS}, l.body_text, l.body_text_source FROM legal_authorities l LEFT JOIN jurisdictions j ON j.id = l.jurisdiction_id WHERE l.id = ?`).bind(c.params.id).first<Record<string, unknown>>();
    if (!row) throw new HttpError(404, "Legal authority not found");
    const [citations, related, discussions] = await Promise.all([citationsFor(c, "legal", c.params.id), relatedContent(c, "legal", c.params.id), discussionsFor(c, "legal", c.params.id)]);
    // Separate the layers the public must be able to tell apart.
    const layers = {
      interpretation: related.filter((x) => x && x.type === "legal" && (x.relationship === "interprets" || x.relationship === "cites")),
      commentary: related.filter((x) => x && x.type === "article"),
      records: related.filter((x) => x && x.type === "document"),
      other: related.filter((x) => x && !["legal", "article", "document"].includes(x.type)),
    };
    const user = await c.user();
    return json({ authority: row, citations, layers, discussions, permissions: { edit: can(user, "legal.write") } });
  });

  r.post("/api/law", async (c) => {
    const user = await c.require("legal.write");
    const b = await c.body(400_000);
    const category = oneOf(b, "category", LEGAL_CATEGORIES, { required: true })!;
    const isCase = category.endsWith("_case");
    const citation = str(b, "citation", { max: 200 });
    const court = str(b, "court", { max: 160 });
    const decided = isoDate(b, "decided_at");
    if (isCase && (!citation || !court || !decided)) throw new HttpError(422, "Court decisions require an official citation, the court and the decision date");
    const bodyText = str(b, "body_text", { max: 300_000, trim: false });
    const bodySource = httpsUrl(b, "body_text_source");
    if (bodyText && !bodySource) throw new HttpError(422, "Legal text must state the official source it was copied from");
    const id = newId();
    await c.db.prepare(
      `INSERT INTO legal_authorities(id,title,short_title,authority_type,category,jurisdiction_id,citation,enacted_at,effective_at,repealed_at,status,text_kind,source_url,annotated_url,summary,version_label,court,decided_at,body_text,body_text_source,sort_order,created_by,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(id, reqStr(b, "title", { max: 300 }), str(b, "short_title", { max: 120 }), isCase ? "decision" : category.includes("statute") ? "statute" : "constitution",
      category, str(b, "jurisdiction_id", { max: 80 }), citation, isoDate(b, "enacted_at"), isoDate(b, "effective_at"), isoDate(b, "repealed_at"),
      oneOf(b, "status", LEGAL_STATUS, { fallback: "in_force" }), oneOf(b, "text_kind", TEXT_KINDS, { fallback: isCase ? "judicial_interpretation" : "current_authority" }),
      httpsUrl(b, "source_url", { required: true }), httpsUrl(b, "annotated_url"), str(b, "summary", { max: 2000 }), str(b, "version_label", { max: 160 }),
      court, decided, bodyText, bodySource, 5000, user.id, now(), now()).run();
    await audit(c, user.id, "legal.created", "legal", id, { category, citation });
    return json({ id }, 201);
  });

  r.patch("/api/law/:id", async (c) => {
    const user = await c.require("legal.write");
    if (!(await c.db.prepare("SELECT 1 FROM legal_authorities WHERE id = ?").bind(c.params.id).first())) throw new HttpError(404, "Legal authority not found");
    const b = await c.body(400_000);
    const sets: string[] = [];
    const args: unknown[] = [];
    const set = (col: string, v: unknown) => { sets.push(`${col} = ?`); args.push(v); };
    if ("summary" in b) set("summary", str(b, "summary", { max: 2000 }));
    if ("status" in b) set("status", oneOf(b, "status", LEGAL_STATUS, { required: true }));
    if ("repealed_at" in b) set("repealed_at", isoDate(b, "repealed_at"));
    if ("annotated_url" in b) set("annotated_url", httpsUrl(b, "annotated_url"));
    if ("version_label" in b) set("version_label", str(b, "version_label", { max: 160 }));
    if ("body_text" in b) {
      const text = str(b, "body_text", { max: 300_000, trim: false });
      const src = httpsUrl(b, "body_text_source");
      if (text && !src) throw new HttpError(422, "Legal text must state the official source it was copied from");
      set("body_text", text); set("body_text_source", src);
    }
    if (!sets.length) throw new HttpError(422, "No changes supplied");
    set("updated_at", now());
    await c.db.prepare(`UPDATE legal_authorities SET ${sets.join(", ")} WHERE id = ?`).bind(...args, c.params.id).run();
    await audit(c, user.id, "legal.updated", "legal", c.params.id, { fields: Object.keys(b) });
    return json({ ok: true });
  });
}
