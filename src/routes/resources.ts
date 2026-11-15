import type { Router, Ctx } from "../lib/context.ts";
import { HttpError, json, publicJson } from "../lib/http.ts";
import { slugify, cleanQuery, httpsUrl, isHttpsUrl, likePattern, oneOf, reqStr, str, stringList } from "../lib/validate.ts";
import { audit, now } from "../lib/store.ts";
import { STARTER_RESOURCES } from "../data/starter.ts";

export const RESOURCE_LEVELS = ["federal", "state", "county", "municipal", "nonprofit", "academic"] as const;
export const SOURCE_CLASSES = ["official", "regulatory", "nonprofit", "academic", "news", "community"] as const;
export const RESOURCE_STATUS = ["unverified", "verified", "needs_review", "broken", "disabled"] as const;

function shape(row: Record<string, unknown>) {
  let subpages: unknown[] = [];
  try { subpages = row.subpages_json ? JSON.parse(String(row.subpages_json)) : []; } catch { subpages = []; }
  const { subpages_json: _s, ...rest } = row;
  return { ...rest, topics: row.topics ? String(row.topics).split(",").map((t) => t.trim()).filter(Boolean) : [], subpages };
}

/** Check one link and classify the outcome. Government sites commonly block HEAD or bots; those are flagged for a human. */
export async function checkLink(url: string): Promise<{ status: string; code: number | null; note: string | null }> {
  const attempt = async (method: string) => fetch(url, { method, redirect: "follow", headers: { "user-agent": "1776FORGE-LinkCheck/1.0 (+public research directory)" }, signal: AbortSignal.timeout(10_000) });
  try {
    let res = await attempt("HEAD");
    if (res.status === 405 || res.status === 403 || res.status === 501) res = await attempt("GET");
    const code = res.status;
    if (code >= 200 && code < 400) return { status: "verified", code, note: res.redirected ? `Redirected to ${res.url}` : null };
    if (code === 404 || code === 410) return { status: "broken", code, note: `HTTP ${code}` };
    return { status: "needs_review", code, note: `HTTP ${code} — the site may block automated checks` };
  } catch (e) {
    return { status: "needs_review", code: null, note: `Request failed: ${e instanceof Error ? e.message : "unknown error"}`.slice(0, 200) };
  }
}

export async function runLinkChecks(db: D1Database, limit = 20): Promise<number> {
  const rows = await db.prepare("SELECT id, url FROM resource_links WHERE status != 'disabled' ORDER BY COALESCE(last_checked_at, '0000') LIMIT ?").bind(limit).all<{ id: string; url: string }>();
  for (const row of rows.results) {
    const result = await checkLink(row.url);
    await db.prepare("UPDATE resource_links SET status = ?, last_status_code = ?, notes = ?, last_checked_at = ? WHERE id = ?").bind(result.status, result.code, result.note, now(), row.id).run();
  }
  return rows.results.length;
}

async function readSubpages(b: Record<string, unknown>): Promise<string | null> {
  const raw = b.subpages;
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw) || raw.length > 12) throw new HttpError(422, "subpages must be a list of up to 12 {label,url} entries");
  const out = raw.map((x) => {
    const label = typeof x?.label === "string" ? x.label.trim().slice(0, 120) : "";
    const url = typeof x?.url === "string" ? x.url.trim() : "";
    if (!label || !isHttpsUrl(url)) throw new HttpError(422, "Each subpage needs a label and an https:// URL");
    return { label, url };
  });
  return JSON.stringify(out);
}

export function registerResources(r: Router): void {
  r.get("/api/resources", async (c: Ctx) => {
    if (!c.env.DB) return publicJson({ items: STARTER_RESOURCES, source: "starter", databaseConfigured: false }, 300);
    const where = ["r.status != 'disabled'"];
    const args: unknown[] = [];
    const level = c.url.searchParams.get("level");
    if (level) { where.push("r.level = ?"); args.push(level); }
    const j = c.url.searchParams.get("jurisdiction");
    if (j) { where.push("r.jurisdiction_id = ?"); args.push(j); }
    const topic = c.url.searchParams.get("topic");
    if (topic) { where.push("(',' || r.topics || ',') LIKE ? ESCAPE '\\'"); args.push(likePattern("," + topic + ",")); }
    const q = cleanQuery(c.url);
    if (q) { where.push("(r.name LIKE ? ESCAPE '\\' OR r.description LIKE ? ESCAPE '\\' OR r.topics LIKE ? ESCAPE '\\' OR r.category LIKE ? ESCAPE '\\')"); const p = likePattern(q); args.push(p, p, p, p); }
    const rows = await c.db.prepare(
      `SELECT r.id, r.name, r.url, r.description, r.category, r.source_kind, r.status, r.level, r.jurisdiction_id, j.name AS jurisdiction_name, r.topics, r.subpages_json, r.last_checked_at, r.last_status_code, r.notes,
         (SELECT COUNT(*) FROM content_links cl WHERE (cl.source_type='resource' AND cl.source_id=r.id) OR (cl.target_type='resource' AND cl.target_id=r.id)) AS related_count
        FROM resource_links r LEFT JOIN jurisdictions j ON j.id = r.jurisdiction_id WHERE ${where.join(" AND ")}
        ORDER BY CASE r.level WHEN 'federal' THEN 1 WHEN 'state' THEN 2 WHEN 'county' THEN 3 WHEN 'municipal' THEN 4 ELSE 5 END, r.name LIMIT 500`,
    ).bind(...args).all<Record<string, unknown>>();
    const topics = new Set<string>();
    for (const row of rows.results) String(row.topics || "").split(",").map((t) => t.trim()).filter(Boolean).forEach((t) => topics.add(t));
    return json({ items: rows.results.map(shape), topics: [...topics].sort(), source: "D1", databaseConfigured: true });
  });

  r.post("/api/resources", async (c) => {
    const user = await c.require("resource.write");
    const b = await c.body();
    const name = reqStr(b, "name", { max: 160 });
    const url = httpsUrl(b, "url", { required: true })!;
    if (await c.db.prepare("SELECT 1 FROM resource_links WHERE url = ?").bind(url).first()) throw new HttpError(409, "This URL is already in the directory");
    const id = slugify(str(b, "id", { max: 60 }) || name).slice(0, 60);
    if (await c.db.prepare("SELECT 1 FROM resource_links WHERE id = ?").bind(id).first()) throw new HttpError(409, "A resource with this identifier exists");
    const topics = stringList(b, "topics", { maxItems: 10, maxLen: 40 });
    await c.db.prepare(`INSERT INTO resource_links(id,name,url,description,category,source_kind,status,level,jurisdiction_id,topics,subpages_json,created_at,updated_at)
                        VALUES (?,?,?,?,?,?,'unverified',?,?,?,?,?,?)`)
      .bind(id, name, url, reqStr(b, "description", { min: 20, max: 1000 }), reqStr(b, "category", { max: 80 }), oneOf(b, "source_kind", SOURCE_CLASSES, { fallback: "official" }),
        oneOf(b, "level", RESOURCE_LEVELS, { required: true }), str(b, "jurisdiction_id", { max: 80 }), topics.join(","), await readSubpages(b), now(), now()).run();
    await audit(c, user.id, "resource.created", "resource", id, { url });
    return json({ id }, 201);
  });

  r.patch("/api/resources/:id", async (c) => {
    const user = await c.require("resource.write");
    if (!(await c.db.prepare("SELECT 1 FROM resource_links WHERE id = ?").bind(c.params.id).first())) throw new HttpError(404, "Resource not found");
    const b = await c.body();
    const sets: string[] = [];
    const args: unknown[] = [];
    const set = (col: string, v: unknown) => { sets.push(`${col} = ?`); args.push(v); };
    if ("name" in b) set("name", reqStr(b, "name", { max: 160 }));
    if ("url" in b) { set("url", httpsUrl(b, "url", { required: true })); set("status", "unverified"); }
    if ("description" in b) set("description", reqStr(b, "description", { min: 20, max: 1000 }));
    if ("category" in b) set("category", reqStr(b, "category", { max: 80 }));
    if ("level" in b) set("level", oneOf(b, "level", RESOURCE_LEVELS, { required: true }));
    if ("source_kind" in b) set("source_kind", oneOf(b, "source_kind", SOURCE_CLASSES, { required: true }));
    if ("jurisdiction_id" in b) set("jurisdiction_id", str(b, "jurisdiction_id", { max: 80 }));
    if ("topics" in b) set("topics", stringList(b, "topics", { maxItems: 10, maxLen: 40 }).join(","));
    if ("subpages" in b) set("subpages_json", await readSubpages(b));
    if ("status" in b && !("url" in b)) set("status", oneOf(b, "status", RESOURCE_STATUS, { required: true }));
    if (!sets.length) throw new HttpError(422, "No changes supplied");
    set("updated_at", now());
    await c.db.prepare(`UPDATE resource_links SET ${sets.join(", ")} WHERE id = ?`).bind(...args, c.params.id).run();
    await audit(c, user.id, "resource.updated", "resource", c.params.id, { fields: Object.keys(b) });
    return json({ ok: true });
  });

  r.post("/api/resources/:id/check", async (c) => {
    const user = await c.require("resource.write");
    const row = await c.db.prepare("SELECT url FROM resource_links WHERE id = ?").bind(c.params.id).first<{ url: string }>();
    if (!row) throw new HttpError(404, "Resource not found");
    const result = await checkLink(row.url);
    await c.db.prepare("UPDATE resource_links SET status = ?, last_status_code = ?, notes = ?, last_checked_at = ? WHERE id = ?").bind(result.status, result.code, result.note, now(), c.params.id).run();
    await audit(c, user.id, "resource.link_checked", "resource", c.params.id, result);
    return json(result);
  });

  r.post("/api/resources/check-batch", async (c) => {
    const user = await c.require("resource.write");
    const checked = await runLinkChecks(c.db, 15);
    await audit(c, user.id, "resource.link_batch_checked", "resource", null, { checked });
    return json({ checked });
  });
}
