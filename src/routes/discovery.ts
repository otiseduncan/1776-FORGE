import type { Router } from "../lib/context.ts";
import { HttpError, json } from "../lib/http.ts";
import { cleanQuery, likePattern } from "../lib/validate.ts";
import { LIST_FIELDS, FROM, shape } from "./news.ts";
import { searchArchive } from "../lib/archive-search.ts";
import { meetingVideos } from '../data/meeting-videos.ts';

const SEARCH_TYPES = ["records", "archive", "videos", "news", "law", "resources", "community", "map", "meetings"] as const;

export function registerDiscovery(r: Router): void {
  r.get("/api/search", async (c) => {
    const q = cleanQuery(c.url);
    if (q.length < 2) throw new HttpError(422, "Enter at least 2 characters");
    const requested = (c.url.searchParams.get("types") || "").split(",").filter((t) => (SEARCH_TYPES as readonly string[]).includes(t));
    const types = new Set(requested.length ? requested : SEARCH_TYPES);
    const p = likePattern(q);
    const lim = types.size === 1 ? 50 : 8;
    const E = "ESCAPE '\\'";
    const run = (t: string, sql: string, args: unknown[]) => types.has(t) ? c.db.prepare(sql).bind(...args, lim).all().then((x) => x.results) : Promise.resolve([]);
    const recordFields = ['d.title', 'd.summary', 'd.citation', 'd.record_date', 'd.original_filename', 'd.document_type', 'j.name', 'a.name'];
    const terms = q.split(/\s+/).slice(0, 12);
    const recordWhere = terms.map(() => '(' + recordFields.map(f => `${f} LIKE ? ${E}`).join(' OR ') + ')').join(' AND ');
    const [records, news, law, resources, community, map, meetings, archive] = await Promise.all([
      run("records", `SELECT d.id, d.title, d.summary AS excerpt, d.record_date AS date, d.verification_state, j.name AS jurisdiction FROM documents d LEFT JOIN jurisdictions j ON j.id = d.jurisdiction_id LEFT JOIN agencies a ON a.id = d.agency_id WHERE d.visibility='public' AND ${recordWhere} ORDER BY d.record_date DESC LIMIT ?`, terms.flatMap(t => recordFields.map(() => likePattern(t)))),
      run("news", `SELECT id, slug, title, summary AS excerpt, published_at AS date, kind FROM articles WHERE status='published' AND (title LIKE ? ${E} OR summary LIKE ? ${E} OR body LIKE ? ${E}) ORDER BY published_at DESC LIMIT ?`, [p, p, p]),
      run("law", `SELECT id, title, citation, summary AS excerpt, category, status FROM legal_authorities WHERE title LIKE ? ${E} OR citation LIKE ? ${E} OR summary LIKE ? ${E} OR short_title LIKE ? ${E} ORDER BY sort_order LIMIT ?`, [p, p, p, p]),
      run("resources", `SELECT id, name AS title, description AS excerpt, url, level, status FROM resource_links WHERE status != 'disabled' AND (name LIKE ? ${E} OR description LIKE ? ${E} OR topics LIKE ? ${E}) ORDER BY name LIMIT ?`, [p, p, p]),
      run("community", `SELECT id, title, substr(body,1,240) AS excerpt, last_activity_at AS date, comment_count FROM discussions WHERE moderation_state='visible' AND (title LIKE ? ${E} OR body LIKE ? ${E}) ORDER BY last_activity_at DESC LIMIT ?`, [p, p]),
      run("map", `SELECT id, title, description AS excerpt, kind, condition_state FROM map_features WHERE verification_state != 'rejected' AND (title LIKE ? ${E} OR description LIKE ? ${E}) ORDER BY title LIMIT ?`, [p, p]),
      run("meetings", `SELECT m.id, m.title, m.meeting_date AS date, b.name AS body FROM meetings m JOIN governing_bodies b ON b.id = m.body_id WHERE m.title LIKE ? ${E} OR b.name LIKE ? ${E} OR EXISTS (SELECT 1 FROM motions mo WHERE mo.meeting_id = m.id AND (mo.title LIKE ? ${E} OR mo.resolution_number LIKE ? ${E})) ORDER BY m.meeting_date DESC LIMIT ?`, [p, p, p, p]),
      types.has('archive') ? searchArchive(c.env, q, lim) : Promise.resolve({ items: [], total: 0, available: true }),
    ]);
    const videos = types.has('videos') ? meetingVideos.filter(v => terms.every(t => (v.title + ' ' + v.original_title + ' ' + v.excerpt).toLowerCase().includes(t.toLowerCase()))) : [];
    const groups = { records, news, law, resources, community, map, meetings, archive: archive.items, videos };
    const total = Object.values(groups).reduce((n, g) => n + g.length, 0);
    return json({ q, total, groups, archiveTotal: archive.total, archiveAvailable: archive.available });
  });

  r.get("/api/home", async (c) => {
    const [featured, latest, records, discussions, resources, law, jurisdictions, stats, mapStats] = await Promise.all([
      c.db.prepare(`SELECT ${LIST_FIELDS} ${FROM} WHERE a.status='published' AND a.featured = 1 ORDER BY a.published_at DESC LIMIT 3`).all<Record<string, unknown>>(),
      c.db.prepare(`SELECT ${LIST_FIELDS} ${FROM} WHERE a.status='published' ORDER BY a.featured DESC, a.published_at DESC, COALESCE(a.original_published_at, a.published_at) DESC LIMIT 7`).all<Record<string, unknown>>(),
      c.db.prepare(`SELECT d.id, d.title, d.record_date, d.verification_state, dc.name AS category_name, j.name AS jurisdiction_name FROM documents d LEFT JOIN document_categories dc ON dc.id = d.category_id LEFT JOIN jurisdictions j ON j.id = d.jurisdiction_id WHERE d.visibility='public' AND d.document_type IN ('minutes','agenda','agenda_packet','report') ORDER BY d.record_date DESC LIMIT 6`).all(),
      c.db.prepare(`SELECT d.id, d.title, substr(d.body,1,200) AS excerpt, d.comment_count, d.last_activity_at, u.display_name AS author, fc.name AS category_name FROM discussions d JOIN users u ON u.id = d.created_by LEFT JOIN forum_categories fc ON fc.id = d.category_id WHERE d.moderation_state='visible' ORDER BY d.last_activity_at DESC LIMIT 5`).all(),
      c.db.prepare(`SELECT id, name, url, description, level, status FROM resource_links WHERE status != 'disabled' ORDER BY CASE status WHEN 'verified' THEN 0 ELSE 1 END, CASE level WHEN 'federal' THEN 1 WHEN 'state' THEN 2 ELSE 3 END, name LIMIT 6`).all(),
      c.db.prepare(`SELECT id, title, short_title, citation, enacted_at, category FROM legal_authorities WHERE id IN ('declaration','constitution','bill-of-rights','amendment-1','amendment-14','ga-open-records') ORDER BY sort_order`).all(),
      c.db.prepare(`SELECT j.id, j.name, j.level, j.parent_id, (SELECT COUNT(*) FROM documents d WHERE d.jurisdiction_id = j.id AND d.visibility='public') AS documents, (SELECT COUNT(*) FROM governing_bodies g WHERE g.jurisdiction_id = j.id) AS bodies, (SELECT COUNT(*) FROM resource_links r WHERE r.jurisdiction_id = j.id AND r.status != 'disabled') AS resources FROM jurisdictions j ORDER BY CASE j.level WHEN 'federal' THEN 1 WHEN 'state' THEN 2 WHEN 'county' THEN 3 ELSE 4 END, j.name LIMIT 12`).all(),
      c.db.prepare(`SELECT (SELECT COUNT(*) FROM documents WHERE visibility='public') AS records, (SELECT COUNT(*) FROM documents WHERE visibility='public' AND verification_state='verified') AS verified_records, (SELECT COUNT(*) FROM articles WHERE status='published') AS articles, (SELECT COUNT(*) FROM discussions WHERE moderation_state='visible') AS discussions, (SELECT COUNT(*) FROM legal_authorities) AS legal, (SELECT COUNT(*) FROM resource_links WHERE status != 'disabled') AS resources, (SELECT COUNT(*) FROM meetings) AS meetings`).first(),
      c.db.prepare(`SELECT kind, condition_state, COUNT(*) AS n FROM map_features WHERE verification_state != 'rejected' GROUP BY kind, condition_state`).all(),
    ]);
    return json({ featured: featured.results.map(shape), latest: latest.results.map(shape), records: records.results, discussions: discussions.results, resources: resources.results, law: law.results, jurisdictions: jurisdictions.results, stats, map: mapStats.results }, 200, { "cache-control": "public, max-age=30" });
  });
}
