import type { Router, Ctx } from "../lib/context.ts";
import { HttpError, json, pageParams } from "../lib/http.ts";
import { newId } from "../lib/crypto.ts";
import { can } from "../auth/permissions.ts";
import { bool, httpsUrl, int, isoDate, oneOf, reqStr, str, videoUrl } from "../lib/validate.ts";
import { audit, citationsFor, discussionsFor, now, relatedContent } from "../lib/store.ts";

const VOTES = ["yea", "nay", "abstain", "absent", "recused"] as const;
const RESULTS = ["passed", "failed", "tabled", "withdrawn", "unrecorded"] as const;

async function mustExist(c: Ctx, table: string, id: string | null, label: string) {
  if (!id) return;
  if (!(await c.db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).bind(id).first())) throw new HttpError(422, `${label} not found`);
}

export function registerCivic(r: Router): void {
  // ---- governing bodies & officials
  r.get("/api/civic/bodies", async (c) => {
    const j = c.url.searchParams.get("jurisdiction");
    const rows = await c.db.prepare(
      `SELECT b.id, b.name, b.official_url, b.jurisdiction_id, j.name AS jurisdiction_name,
        (SELECT COUNT(*) FROM meetings m WHERE m.body_id = b.id) AS meetings,
        (SELECT COUNT(*) FROM officials o WHERE o.body_id = b.id) AS officials
       FROM governing_bodies b JOIN jurisdictions j ON j.id = b.jurisdiction_id ${j ? "WHERE b.jurisdiction_id = ?" : ""} ORDER BY j.name, b.name`,
    ).bind(...(j ? [j] : [])).all();
    return json({ items: rows.results });
  });

  r.get("/api/civic/bodies/:id", async (c) => {
    const body = await c.db.prepare("SELECT b.*, j.name AS jurisdiction_name FROM governing_bodies b JOIN jurisdictions j ON j.id = b.jurisdiction_id WHERE b.id = ?").bind(c.params.id).first();
    if (!body) throw new HttpError(404, "Governing body not found");
    const [officials, meetings] = await Promise.all([
      c.db.prepare("SELECT * FROM officials WHERE body_id = ? ORDER BY COALESCE(term_end, '9999') DESC, name").bind(c.params.id).all(),
      c.db.prepare("SELECT id, title, meeting_date, meeting_type, minutes_status, video_url, (SELECT COUNT(*) FROM motions mo WHERE mo.meeting_id = m.id) AS motions FROM meetings m WHERE body_id = ? ORDER BY meeting_date DESC LIMIT 100").bind(c.params.id).all(),
    ]);
    return json({ body, officials: officials.results, meetings: meetings.results });
  });

  r.post("/api/civic/bodies", async (c) => {
    const user = await c.require("civic.write");
    const b = await c.body();
    const jurisdiction = reqStr(b, "jurisdiction_id", { max: 80 });
    await mustExist(c, "jurisdictions", jurisdiction, "Jurisdiction");
    const id = newId();
    await c.db.prepare("INSERT INTO governing_bodies(id,jurisdiction_id,name,official_url,created_at) VALUES (?,?,?,?,?)").bind(id, jurisdiction, reqStr(b, "name", { max: 160 }), httpsUrl(b, "official_url"), now()).run();
    await audit(c, user.id, "civic.body_created", "governing_body", id);
    return json({ id }, 201);
  });

  r.post("/api/civic/officials", async (c) => {
    const user = await c.require("civic.write");
    const b = await c.body();
    const bodyId = reqStr(b, "body_id", { max: 80 });
    await mustExist(c, "governing_bodies", bodyId, "Governing body");
    const source = httpsUrl(b, "source_url", { required: true });
    const id = newId();
    await c.db.prepare("INSERT INTO officials(id,body_id,name,office,district,term_start,term_end,source_url,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(id, bodyId, reqStr(b, "name", { max: 120 }), reqStr(b, "office", { max: 120 }), str(b, "district", { max: 60 }), isoDate(b, "term_start"), isoDate(b, "term_end"), source, now()).run();
    await audit(c, user.id, "civic.official_created", "official", id);
    return json({ id }, 201);
  });

  r.get("/api/civic/officials/:id", async (c) => {
    const o = await c.db.prepare("SELECT o.*, b.name AS body_name, b.jurisdiction_id FROM officials o JOIN governing_bodies b ON b.id = o.body_id WHERE o.id = ?").bind(c.params.id).first();
    if (!o) throw new HttpError(404, "Official not found");
    const votes = await c.db.prepare(
      `SELECT v.vote, mo.id AS motion_id, mo.title, mo.result, mo.resolution_number, m.id AS meeting_id, m.meeting_date, m.title AS meeting_title
         FROM votes v JOIN motions mo ON mo.id = v.motion_id JOIN meetings m ON m.id = mo.meeting_id WHERE v.official_id = ? ORDER BY m.meeting_date DESC LIMIT 500`,
    ).bind(c.params.id).all<{ vote: string }>();
    const tally: Record<string, number> = {};
    for (const v of votes.results) tally[v.vote] = (tally[v.vote] || 0) + 1;
    return json({ official: o, votes: votes.results, tally });
  });

  // ---- meetings, motions and votes
  r.get("/api/civic/meetings", async (c) => {
    const { page, size, offset } = pageParams(c.url, 20, 100);
    const where: string[] = [];
    const args: unknown[] = [];
    const body = c.url.searchParams.get("body");
    if (body) { where.push("m.body_id = ?"); args.push(body); }
    const j = c.url.searchParams.get("jurisdiction");
    if (j) { where.push("b.jurisdiction_id = ?"); args.push(j); }
    const from = c.url.searchParams.get("from");
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) { where.push("m.meeting_date >= ?"); args.push(from); }
    const to = c.url.searchParams.get("to");
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) { where.push("m.meeting_date <= ?"); args.push(to); }
    const w = where.length ? "WHERE " + where.join(" AND ") : "";
    const total = await c.db.prepare(`SELECT COUNT(*) AS n FROM meetings m JOIN governing_bodies b ON b.id = m.body_id ${w}`).bind(...args).first<{ n: number }>();
    const rows = await c.db.prepare(
      `SELECT m.id, m.title, m.meeting_date, m.meeting_type, m.minutes_status, m.video_url, m.agenda_document_id, m.minutes_document_id, m.transcript_document_id,
              b.id AS body_id, b.name AS body_name, b.jurisdiction_id, (SELECT COUNT(*) FROM motions mo WHERE mo.meeting_id = m.id) AS motions
         FROM meetings m JOIN governing_bodies b ON b.id = m.body_id ${w} ORDER BY m.meeting_date DESC LIMIT ? OFFSET ?`,
    ).bind(...args, size, offset).all();
    return json({ items: rows.results, total: total?.n ?? 0, page, pageSize: size });
  });

  r.get("/api/civic/meetings/:id", async (c) => {
    const m = await c.db.prepare(
      `SELECT m.*, b.name AS body_name, b.jurisdiction_id, ag.title AS agenda_title, mi.title AS minutes_title, tr.title AS transcript_title
         FROM meetings m JOIN governing_bodies b ON b.id = m.body_id
         LEFT JOIN documents ag ON ag.id = m.agenda_document_id LEFT JOIN documents mi ON mi.id = m.minutes_document_id LEFT JOIN documents tr ON tr.id = m.transcript_document_id
        WHERE m.id = ?`,
    ).bind(c.params.id).first<Record<string, unknown>>();
    if (!m) throw new HttpError(404, "Meeting not found");
    const motions = await c.db.prepare(
      `SELECT mo.*, mv.name AS moved_by_name, sc.name AS seconded_by_name, d.title AS supporting_document_title
         FROM motions mo LEFT JOIN officials mv ON mv.id = mo.moved_by LEFT JOIN officials sc ON sc.id = mo.seconded_by LEFT JOIN documents d ON d.id = mo.supporting_document_id
        WHERE mo.meeting_id = ? ORDER BY mo.item_number, mo.created_at`,
    ).bind(c.params.id).all<Record<string, unknown>>();
    const votes = motions.results.length
      ? await c.db.prepare(`SELECT v.motion_id, v.vote, o.id AS official_id, o.name, o.office FROM votes v JOIN officials o ON o.id = v.official_id WHERE v.motion_id IN (${motions.results.map(() => "?").join(",")}) ORDER BY o.name`).bind(...motions.results.map((x) => x.id)).all<Record<string, unknown>>()
      : { results: [] as Record<string, unknown>[] };
    const [citations, related, discussions] = await Promise.all([citationsFor(c, "meeting", c.params.id), relatedContent(c, "meeting", c.params.id), discussionsFor(c, "meeting", c.params.id)]);
    return json({ meeting: m, motions: motions.results.map((mo) => ({ ...mo, votes: votes.results.filter((v) => v.motion_id === mo.id) })), citations, related, discussions });
  });

  r.post("/api/civic/meetings", async (c) => {
    const user = await c.require("civic.write");
    const b = await c.body();
    const bodyId = reqStr(b, "body_id", { max: 80 });
    await mustExist(c, "governing_bodies", bodyId, "Governing body");
    const agenda = str(b, "agenda_document_id", { max: 80 });
    const minutes = str(b, "minutes_document_id", { max: 80 });
    const transcript = str(b, "transcript_document_id", { max: 80 });
    for (const [id, label] of [[agenda, "Agenda record"], [minutes, "Minutes record"], [transcript, "Transcript record"]] as const) await mustExist(c, "documents", id, label);
    const video = videoUrl(b);
    const source = httpsUrl(b, "source_url");
    if (!agenda && !minutes && !transcript && !video && !source) throw new HttpError(422, "A meeting must reference at least one source: agenda, minutes, transcript, video or official source URL");
    const id = newId();
    await c.db.prepare(`INSERT INTO meetings(id,body_id,meeting_date,meeting_type,title,agenda_document_id,minutes_document_id,transcript_document_id,video_url,minutes_status,source_url,created_by,created_at)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, bodyId, isoDate(b, "meeting_date", { required: true }), oneOf(b, "meeting_type", ["regular", "special", "called", "work_session", "hearing", "retreat"] as const, { fallback: "regular" }),
        reqStr(b, "title", { max: 200 }), agenda, minutes, transcript, video, oneOf(b, "minutes_status", ["unavailable", "draft", "approved"] as const, { fallback: minutes ? "approved" : "unavailable" }), source, user.id, now()).run();
    await audit(c, user.id, "civic.meeting_created", "meeting", id);
    return json({ id }, 201);
  });

  r.post("/api/civic/meetings/:id/motions", async (c) => {
    const user = await c.require("civic.write");
    const meeting = await c.db.prepare("SELECT m.*, b.id AS body FROM meetings m JOIN governing_bodies b ON b.id = m.body_id WHERE m.id = ?").bind(c.params.id).first<Record<string, string>>();
    if (!meeting) throw new HttpError(404, "Meeting not found");
    const b = await c.body();
    const supporting = str(b, "supporting_document_id", { max: 80 });
    await mustExist(c, "documents", supporting, "Supporting record");
    if (!supporting && !meeting.minutes_document_id && !meeting.video_url && !meeting.transcript_document_id) {
      throw new HttpError(422, "Votes and motions must be sourced: attach the minutes, transcript or video to the meeting, or cite a supporting record");
    }
    const officials = await c.db.prepare("SELECT id FROM officials WHERE body_id = ?").bind(meeting.body).all<{ id: string }>();
    const officialIds = new Set(officials.results.map((o) => o.id));
    const moved = str(b, "moved_by", { max: 80 });
    const seconded = str(b, "seconded_by", { max: 80 });
    for (const o of [moved, seconded]) if (o && !officialIds.has(o)) throw new HttpError(422, "Mover and seconder must be officials of this governing body");
    const votesIn = Array.isArray(b.votes) ? b.votes : [];
    if (votesIn.length > 40) throw new HttpError(422, "Too many votes");
    const seen = new Set<string>();
    const votes = votesIn.map((v) => {
      const official = typeof v?.official_id === "string" ? v.official_id : "";
      const vote = typeof v?.vote === "string" ? v.vote : "";
      if (!officialIds.has(official)) throw new HttpError(422, "Each vote must name an official of this governing body");
      if (!(VOTES as readonly string[]).includes(vote)) throw new HttpError(422, `Vote must be one of ${VOTES.join(", ")}`);
      if (seen.has(official)) throw new HttpError(422, "An official may only vote once per motion");
      seen.add(official);
      return { official, vote };
    });
    const id = newId();
    const stmts = [
      c.db.prepare(`INSERT INTO motions(id,meeting_id,item_number,title,motion_text,resolution_number,moved_by,seconded_by,result,supporting_document_id,source_pinpoint,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(id, c.params.id, str(b, "item_number", { max: 20 }), reqStr(b, "title", { max: 300 }), str(b, "motion_text", { max: 5000 }), str(b, "resolution_number", { max: 60 }), moved, seconded,
          oneOf(b, "result", RESULTS, { fallback: "unrecorded" }), supporting, str(b, "source_pinpoint", { max: 120 }), now()),
      ...votes.map((v) => c.db.prepare("INSERT INTO votes(motion_id,official_id,vote) VALUES (?,?,?)").bind(id, v.official, v.vote)),
    ];
    await c.db.batch(stmts);
    await audit(c, user.id, "civic.motion_recorded", "motion", id, { meeting: c.params.id, votes: votes.length });
    return json({ id }, 201);
  });

  // ---- budgets & financial reports
  r.get("/api/civic/budgets", async (c) => {
    const j = c.url.searchParams.get("jurisdiction");
    const rows = await c.db.prepare(
      `SELECT bu.id, bu.title, bu.fiscal_year, bu.stage, bu.jurisdiction_id, j.name AS jurisdiction_name, bu.document_id, bu.source_url,
         (SELECT SUM(amount_cents) FROM budget_line_items li WHERE li.budget_id = bu.id AND li.line_type='revenue') AS revenue_cents,
         (SELECT SUM(amount_cents) FROM budget_line_items li WHERE li.budget_id = bu.id AND li.line_type='expenditure') AS expenditure_cents,
         (SELECT COUNT(*) FROM budget_line_items li WHERE li.budget_id = bu.id) AS line_items
        FROM budgets bu JOIN jurisdictions j ON j.id = bu.jurisdiction_id ${j ? "WHERE bu.jurisdiction_id = ?" : ""} ORDER BY bu.fiscal_year DESC, j.name LIMIT 200`,
    ).bind(...(j ? [j] : [])).all();
    const reports = await c.db.prepare(
      `SELECT f.*, j.name AS jurisdiction_name, d.title AS document_title FROM financial_reports f JOIN jurisdictions j ON j.id = f.jurisdiction_id LEFT JOIN documents d ON d.id = f.document_id
        ${j ? "WHERE f.jurisdiction_id = ?" : ""} ORDER BY f.fiscal_year DESC LIMIT 200`,
    ).bind(...(j ? [j] : [])).all();
    return json({ budgets: rows.results, financialReports: reports.results });
  });

  r.get("/api/civic/budgets/compare", async (c) => {
    const j = c.url.searchParams.get("jurisdiction");
    if (!j) throw new HttpError(422, "jurisdiction is required");
    const stage = c.url.searchParams.get("stage") || "adopted";
    const rows = await c.db.prepare(
      `SELECT bu.fiscal_year, li.department, li.line_type, SUM(li.amount_cents) AS amount_cents
         FROM budgets bu JOIN budget_line_items li ON li.budget_id = bu.id
        WHERE bu.jurisdiction_id = ? AND bu.stage = ? GROUP BY bu.fiscal_year, li.department, li.line_type ORDER BY li.department, bu.fiscal_year`,
    ).bind(j, stage).all<{ fiscal_year: number; department: string; line_type: string; amount_cents: number }>();
    const years = [...new Set(rows.results.map((x) => x.fiscal_year))].sort();
    const byDept = new Map<string, Record<string, unknown>>();
    for (const x of rows.results) {
      const key = `${x.line_type}:${x.department}`;
      const entry = byDept.get(key) || { department: x.department, line_type: x.line_type, amounts: {} as Record<number, number> };
      (entry.amounts as Record<number, number>)[x.fiscal_year] = x.amount_cents;
      byDept.set(key, entry);
    }
    return json({ jurisdiction: j, stage, years, rows: [...byDept.values()] });
  });

  r.get("/api/civic/budgets/:id", async (c) => {
    const bu = await c.db.prepare("SELECT bu.*, j.name AS jurisdiction_name, d.title AS document_title FROM budgets bu JOIN jurisdictions j ON j.id = bu.jurisdiction_id LEFT JOIN documents d ON d.id = bu.document_id WHERE bu.id = ?").bind(c.params.id).first();
    if (!bu) throw new HttpError(404, "Budget not found");
    const lines = await c.db.prepare("SELECT * FROM budget_line_items WHERE budget_id = ? ORDER BY line_type DESC, fund, department").bind(c.params.id).all();
    const [citations, discussions] = await Promise.all([citationsFor(c, "budget", c.params.id), discussionsFor(c, "budget", c.params.id)]);
    return json({ budget: bu, lines: lines.results, citations, discussions });
  });

  r.post("/api/civic/budgets", async (c) => {
    const user = await c.require("civic.write");
    const b = await c.body();
    const j = reqStr(b, "jurisdiction_id", { max: 80 });
    await mustExist(c, "jurisdictions", j, "Jurisdiction");
    const doc = str(b, "document_id", { max: 80 });
    await mustExist(c, "documents", doc, "Budget record");
    const source = httpsUrl(b, "source_url");
    if (!doc && !source) throw new HttpError(422, "A budget must cite its source record or official URL");
    const id = newId();
    try {
      await c.db.prepare("INSERT INTO budgets(id,jurisdiction_id,fiscal_year,stage,title,document_id,source_url,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(id, j, int(b, "fiscal_year", { required: true, min: 1900, max: 2100 }), oneOf(b, "stage", ["proposed", "adopted", "amended", "actual"] as const, { fallback: "adopted" }), reqStr(b, "title", { max: 200 }), doc, source, user.id, now()).run();
    } catch (e) {
      if (String(e).includes("UNIQUE")) throw new HttpError(409, "A budget with this jurisdiction, year, stage and title already exists");
      throw e;
    }
    await audit(c, user.id, "civic.budget_created", "budget", id);
    return json({ id }, 201);
  });

  r.post("/api/civic/budgets/:id/lines", async (c) => {
    const user = await c.require("civic.write");
    if (!(await c.db.prepare("SELECT 1 FROM budgets WHERE id = ?").bind(c.params.id).first())) throw new HttpError(404, "Budget not found");
    const b = await c.body(1_000_000);
    if (!Array.isArray(b.lines) || !b.lines.length || b.lines.length > 500) throw new HttpError(422, "lines must contain 1–500 line items");
    const replace = bool(b, "replace") === true;
    const stmts: D1PreparedStatement[] = replace ? [c.db.prepare("DELETE FROM budget_line_items WHERE budget_id = ?").bind(c.params.id)] : [];
    b.lines.forEach((raw: unknown, i: number) => {
      const line = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      try {
        const dept = reqStr(line, "department", { max: 120 });
        const type = oneOf(line, "line_type", ["revenue", "expenditure"] as const, { required: true });
        const amount = int(line, "amount_cents", { required: true, min: -1e14, max: 1e14 });
        stmts.push(c.db.prepare("INSERT INTO budget_line_items(id,budget_id,fund,department,line_type,description,amount_cents,source_pinpoint) VALUES (?,?,?,?,?,?,?,?)")
          .bind(newId(), c.params.id, str(line, "fund", { max: 120 }) || "General Fund", dept, type, str(line, "description", { max: 300 }), amount, str(line, "source_pinpoint", { max: 120 })));
      } catch (e) {
        if (e instanceof HttpError) throw new HttpError(422, `Line ${i + 1}: ${e.message}`);
        throw e;
      }
    });
    await c.db.batch(stmts);
    await audit(c, user.id, "civic.budget_lines_imported", "budget", c.params.id, { count: b.lines.length, replace });
    return json({ imported: b.lines.length }, 201);
  });

  r.post("/api/civic/financial-reports", async (c) => {
    const user = await c.require("civic.write");
    const b = await c.body();
    const j = reqStr(b, "jurisdiction_id", { max: 80 });
    await mustExist(c, "jurisdictions", j, "Jurisdiction");
    const doc = str(b, "document_id", { max: 80 });
    await mustExist(c, "documents", doc, "Report record");
    const source = httpsUrl(b, "source_url");
    if (!doc && !source) throw new HttpError(422, "A financial report must cite its source record or official URL");
    const audited = bool(b, "audited") === true;
    const auditor = str(b, "auditor", { max: 160 });
    if (audited && !auditor) throw new HttpError(422, "Audited reports must name the auditor");
    const id = newId();
    await c.db.prepare("INSERT INTO financial_reports(id,jurisdiction_id,fiscal_year,report_type,audited,auditor,opinion,document_id,source_url,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id, j, int(b, "fiscal_year", { required: true, min: 1900, max: 2100 }), reqStr(b, "report_type", { max: 80 }), audited ? 1 : 0, auditor,
        oneOf(b, "opinion", ["unmodified", "qualified", "adverse", "disclaimer", "not_stated"] as const, { fallback: "not_stated" }), doc, source, user.id, now()).run();
    await audit(c, user.id, "civic.financial_report_created", "financial_report", id);
    return json({ id }, 201);
  });

  r.get("/api/civic/summary", async (c) => {
    const user = await c.user();
    const counts = await c.db.prepare(
      `SELECT (SELECT COUNT(*) FROM governing_bodies) AS bodies, (SELECT COUNT(*) FROM meetings) AS meetings, (SELECT COUNT(*) FROM motions) AS motions,
              (SELECT COUNT(*) FROM votes) AS votes, (SELECT COUNT(*) FROM budgets) AS budgets, (SELECT COUNT(*) FROM financial_reports) AS financial_reports`,
    ).first();
    return json({ counts, permissions: { write: can(user, "civic.write") } });
  });
}
