import { h, icon, clear } from "../core/dom.js";
import { get, post, patch, qs } from "../core/api.js";
import { date, ago, label } from "../core/format.js";
import { pageHero, setTitle, empty, notice, field, bindForm, toast, modal } from "../core/ui.js";
import { renderMarkdown } from "../core/markdown.js";
import { user, can } from "../core/session.js";

const SECTIONS = [
  ["", "Overview", "layers", () => can("article.draft") || can("document.create")],
  ["articles", "Articles", "news", () => can("article.draft")],
  ["records", "Records", "doc", () => can("document.create")],
  ["map", "Map features", "map", () => can("map.feature.write")],
  ["civic", "Meetings & budgets", "vote", () => can("civic.write")],
];

function denied(view, text = "The contributor workspace is available to contributors, researchers and editors.") {
  setTitle("Workspace");
  view.append(h("div.container.section", empty({ iconName: "lock", title: user() ? "You don't have workspace access" : "Sign in to use the workspace", text,
    actions: user() ? h("a.btn.btn-ghost", { href: "/community" }, "Go to the community") : h("a.btn.btn-gold", { href: "/signin?return=/workspace" }, "Sign in") })));
}

function shell(view, section, content) {
  view.append(pageHero({ eyebrow: "Contributor workspace", title: SECTIONS.find((s) => s[0] === section)?.[1] || "Workspace" }));
  view.append(h("div.container.section", h("div.ws-layout",
    h("nav.ws-nav", { "aria-label": "Workspace" }, SECTIONS.filter((s) => s[3]()).map(([id, l, ic]) => h("a", { href: `/workspace${id ? "/" + id : ""}`, "aria-current": id === section ? "page" : undefined }, icon(ic, 18), l)),
      (can("moderate") || can("users.manage")) ? h("a", { href: "/admin" }, icon("shield", 18), "Administration") : null),
    h("div.stack", content))));
}

export async function workspace({ view, params }) {
  const section = params.section || "";
  const def = SECTIONS.find((s) => s[0] === section);
  if (!def) { const { notFound } = await import("./static.js"); return notFound({ view }); }
  if (!def[3]()) return denied(view);
  setTitle(def[1] + " · Workspace");
  const content = h("div.stack");
  shell(view, section, content);
  if (section === "") await overview(content);
  else if (section === "articles") await articlesList(content);
  else if (section === "records") content.append(h("section.panel", h("h3", "Archive a public record"), h("p", "Upload the original file with its source and jurisdiction. Files are fingerprinted (SHA-256) and stored unchanged; possible duplicates are flagged before saving."), h("div.btn-row", h("a.btn.btn-gold", { href: "/records/new" }, icon("upload", 16), "Add a record"), h("a.btn.btn-ghost", { href: "/records?verification=unreviewed" }, "Unreviewed records"))));
  else if (section === "map") mapForm(content);
  else if (section === "civic") await civicForms(content);
}

async function overview(content) {
  const data = await get("/api/admin/overview").catch(() => null);
  const c = data?.counts || {};
  const tile = (n, l, href) => h("a.card.interactive", { href, style: { textDecoration: "none" } }, h("strong", { style: { font: "700 2rem/1 var(--font-display)", color: "var(--heading)" } }, String(n ?? 0)), h("div.small.muted", l));
  content.append(h("div.grid.grid-3",
    can("article.draft") && tile(c.articles_draft, "Drafts", "/workspace/articles?status=draft"),
    can("article.draft") && tile(c.articles_in_review, "Articles in review", "/workspace/articles?status=review"),
    can("document.create") && tile(c.documents_unreviewed, "Unreviewed records", "/records?verification=unreviewed"),
    can("document.create") && tile(c.documents_without_file, "Records without original file", "/records"),
    can("map.feature.write") && tile(c.map_features, "Map features", "/map"),
    can("moderate") && tile(c.pending_map_reports, "Map reports awaiting review", "/admin/moderation")));
  content.append(notice("Everything you publish must cite its source. Votes require minutes, transcripts or video; road conditions require a source; court decisions require an official citation.", "gold", "shield"));
}

async function articlesList(content) {
  const status = new URLSearchParams(location.search).get("status") || "";
  const data = await get("/api/workspace/articles" + qs({ status }));
  content.append(h("div", { style: { display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", alignItems: "center" } },
    h("div.chips", ["", "draft", "review", "published", "archived"].map((s) => h("button.chip", { type: "button", "aria-pressed": String(status === s), onclick: () => window.forgeNavigate("/workspace/articles" + qs({ status: s })) }, s ? label("status", s) : "All"))),
    h("a.btn.btn-gold", { href: "/workspace/articles/new" }, icon("plus", 16), "New article")));
  if (!data.items.length) { content.append(empty({ iconName: "news", title: "No articles here", text: "Drafts you write appear here until an editor publishes them." })); return; }
  content.append(h("div.table-wrap", h("table.data", h("thead", h("tr", h("th", "Title"), h("th", "Status"), h("th", "Author"), h("th", "Updated"))),
    h("tbody", data.items.map((a) => h("tr",
      h("td", h("a", { href: `/workspace/articles/${a.id}` }, a.title), a.review_note && a.status === "draft" ? h("div.small", { style: { color: "var(--warning)" } }, "Returned: ", a.review_note) : null),
      h("td", h(`span.status-pill.${a.status}`, label("status", a.status)), a.featured ? h("span.badge.badge-gold", { style: { marginLeft: "6px" } }, "Featured") : null),
      h("td", a.author), h("td", ago(a.updated_at || a.published_at))))))));
}

export async function articleEditor({ view, params }) {
  if (!can("article.draft")) return denied(view);
  const isNew = params.id === "new";
  const [cats, data] = await Promise.all([get("/api/news/categories"), isNew ? null : get(`/api/news/${encodeURIComponent(params.id)}`)]);
  const a = data?.article || { status: "draft", kind: "report", tags: [] };
  setTitle(isNew ? "New article" : `Edit: ${a.title}`);
  const content = h("div.stack");
  shell(view, "articles", content);
  content.prepend(h("div", { style: { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" } }, h("a", { href: "/workspace/articles" }, "← Articles"), h(`span.status-pill.${a.status}`, label("status", a.status)), a.current_version ? h("span.small.muted", `Version ${a.current_version}`) : null, a.status === "published" ? h("a.small", { href: `/news/${a.slug}` }, "View published ", icon("external", 12)) : null));
  if (a.review_note && a.status === "draft") content.append(notice(h("span", h("strong", "Editor notes: "), a.review_note), "warning", "edit"));

  const preview = h("div.prose.panel", { style: { minHeight: "300px" } });
  const bodyField = field({ name: "body", label: "Body (Markdown)", type: "textarea", rows: 22, value: a.body, required: true, hint: "Headings (##), **bold**, lists, > quotes and [links](https://…). Link records with their /records/… URL." });
  const updatePreview = () => clear(preview).append(renderMarkdown(bodyField.querySelector("textarea").value || "*Preview appears here.*"));
  bodyField.querySelector("textarea").addEventListener("input", updatePreview);
  updatePreview();
  const form = h("form.panel",
    field({ name: "title", label: "Headline", value: a.title, required: true, max: 200 }),
    field({ name: "summary", label: "Summary / dek", type: "textarea", rows: 2, value: a.summary, max: 600 }),
    h("div.grid.grid-3",
      field({ name: "kind", label: "Type", type: "select", value: a.kind, options: ["investigation", "report", "update", "explainer", "commentary"].map((v) => ({ value: v, label: label("kind", v) })) }),
      field({ name: "category_id", label: "Category", type: "select", value: a.category_id, options: [{ value: "", label: "—" }, ...cats.items.map((c) => ({ value: c.id, label: c.name }))] }),
      field({ name: "jurisdiction_id", label: "Jurisdiction", type: "select", value: a.jurisdiction_id, options: [["", "—"], ["us", "United States"], ["ga", "Georgia"], ["ga-baldwin", "Baldwin County"], ["ga-milledgeville", "Milledgeville"]].map(([value, l]) => ({ value, label: l })) })),
    field({ name: "tags", label: "Tags (comma-separated)", value: (a.tags || []).join(", ") }),
    field({ name: "video_url", label: "Video (YouTube, Vimeo or Internet Archive URL)", type: "url", value: a.video_url }),
    h("div.editor-split", bodyField, h("div", h("div.small.muted", { style: { marginBottom: "6px", fontWeight: 600 } }, "Preview"), preview)),
    a.status === "published" ? field({ name: "change_note", label: "Change note (required for published articles)", required: true, max: 300, hint: "Describe what changed. Substantive factual fixes should also get a public correction." }) : null,
    h("div.btn-row", h("button.btn.btn-blue", { type: "submit" }, isNew ? "Create draft" : "Save")));
  bindForm(form, async (d) => {
    const body = { ...d, tags: (d.tags || "").split(",").map((t) => t.trim()).filter(Boolean) };
    if (isNew) { const r = await post("/api/news", body); toast("Draft created.", "success"); window.forgeNavigate(`/workspace/articles/${r.id}`, { replace: true }); }
    else { await patch(`/api/news/${a.id}`, body); toast("Saved.", "success"); window.forgeNavigate(location.pathname, { replace: true }); }
  });
  content.append(form);
  if (isNew) return;

  const me = user();
  const actions = h("section.panel", h("h3", "Workflow"));
  const row = h("div.btn-row");
  if (a.status === "draft" && a.author_id === me.id) row.append(h("button.btn.btn-gold", { type: "button", onclick: async () => { await post(`/api/news/${a.id}/submit`); toast("Submitted for editorial review.", "success"); window.forgeNavigate(location.pathname, { replace: true }); } }, "Submit for review"));
  if (data.permissions.publish && (a.status === "review" || a.status === "draft")) {
    row.append(h("button.btn.btn-gold", { type: "button", onclick: () => reviewDialog(a, "publish") }, icon("check", 16), "Publish"));
    row.append(h("button.btn.btn-ghost", { type: "button", onclick: () => reviewDialog(a, "return") }, "Return to author"));
  }
  if (data.permissions.publish && a.status === "published") {
    row.append(h("button.btn.btn-ghost", { type: "button", onclick: async () => { await post(`/api/news/${a.id}/feature`, { featured: !a.featured }); toast(a.featured ? "Removed from featured." : "Featured on the homepage.", "success"); window.forgeNavigate(location.pathname, { replace: true }); } }, icon("star", 16), a.featured ? "Unfeature" : "Feature"));
    row.append(h("button.btn.btn-ghost", { type: "button", onclick: async () => { const reason = prompt("Reason for archiving (recorded in the audit log):"); if (!reason) return; await post(`/api/news/${a.id}/archive`, { reason }); toast("Archived.", "success"); window.forgeNavigate(location.pathname, { replace: true }); } }, "Archive"));
  }
  actions.append(row.children.length ? row : h("p.small.muted", a.status === "review" ? "Waiting for an editor. A different editor must publish your work." : "No workflow actions available."));
  content.append(actions);
  content.append(await versionsPanel(a.id));
}

function reviewDialog(a, decision) {
  const form = h("form", field({ name: "note", label: decision === "publish" ? "Note to author (optional)" : "What needs to change?", type: "textarea", rows: 4, required: decision === "return" }),
    h("button.btn.btn-gold", { type: "submit" }, decision === "publish" ? "Publish now" : "Return to author"));
  const dlg = modal(decision === "publish" ? `Publish “${a.title}”` : "Return to author", form);
  bindForm(form, async (d) => { await post(`/api/news/${a.id}/review`, { decision, note: d.note }); dlg.close(); toast(decision === "publish" ? "Published." : "Returned to author.", "success"); window.forgeNavigate(location.pathname, { replace: true }); });
}

async function versionsPanel(id) {
  const data = await get(`/api/news/${id}/versions`).catch(() => ({ items: [] }));
  return h("section.panel", h("h3", icon("layers", 14), " Version history"), data.items.length ? h("ol.list-plain", { style: { display: "grid", gap: "8px" } }, data.items.map((v) => h("li", h("details",
    h("summary", h("strong", `v${v.version}`), ` · ${label("status", v.status)} · ${v.editor || "—"} · ${date(v.created_at)}`, v.note ? h("span.muted", ` — ${v.note}`) : null),
    h("div.prose", { style: { marginTop: "8px", maxHeight: "320px", overflow: "auto", borderLeft: "3px solid var(--border)", paddingLeft: "12px" } }, renderMarkdown(v.body || "")))))) : h("p.small.muted", "No versions yet."));
}

function mapForm(content) {
  content.append(notice("Draw or export the geometry from a GIS tool as GeoJSON (Point, LineString or Polygon, WGS84 lon/lat). Ratings other than “not rated” must cite where the rating came from. Never estimate a road's classification or condition.", "gold", "map"));
  const form = h("form.panel", h("h3", "Add a map feature"),
    h("div.grid.grid-2",
      field({ name: "kind", label: "Feature type", type: "select", required: true, options: [["road", "Road"], ["project", "Project"], ["facility", "Facility"], ["boundary", "Boundary"]].map(([value, l]) => ({ value, label: l })) }),
      field({ name: "jurisdiction_id", label: "Jurisdiction", type: "select", options: [["ga-baldwin", "Baldwin County"], ["ga-milledgeville", "Milledgeville"], ["ga", "Georgia"]].map(([value, l]) => ({ value, label: l })) })),
    field({ name: "title", label: "Name", required: true, max: 200 }),
    field({ name: "description", label: "Description", type: "textarea", rows: 3, max: 4000 }),
    field({ name: "geometry", label: "GeoJSON geometry", type: "textarea", rows: 6, required: true, placeholder: '{"type":"LineString","coordinates":[[-83.23,33.08],[-83.22,33.09]]}' }),
    h("div.grid.grid-2",
      field({ name: "condition_state", label: "Condition", type: "select", options: [["gray", "Not rated / unknown"], ["green", "Good"], ["yellow", "Fair / watch"], ["red", "Poor / hazard"]].map(([value, l]) => ({ value, label: l })) }),
      field({ name: "condition_observed_at", label: "Condition observed on", type: "date" })),
    field({ name: "condition_note", label: "Condition note", max: 1000 }),
    h("div.grid.grid-2", field({ name: "source_url", label: "Source URL", type: "url" }), field({ name: "source_document_id", label: "or archived record ID" })),
    field({ name: "source_label", label: "Source description", hint: "e.g. GDOT pavement condition report 2025, p. 14" }),
    h("button.btn.btn-gold", { type: "submit" }, "Add feature"));
  bindForm(form, async (d) => {
    let geometry;
    try { geometry = JSON.parse(d.geometry); } catch { throw new Error("Geometry is not valid JSON"); }
    if (geometry.type === "Feature") geometry = geometry.geometry;
    const r = await post("/api/map/features", { ...d, geometry });
    toast("Feature added for review.", "success");
    window.forgeNavigate(`/map?feature=${r.id}`);
  });
  content.append(form);
}

async function civicForms(content) {
  const [bodies, docsNote] = [await get("/api/civic/bodies"), "Record IDs are shown on each record page (the last part of its URL)."];
  const bodyOpts = bodies.items.map((b) => ({ value: b.id, label: `${b.name} (${b.jurisdiction_name})` }));
  const juris = [["ga-baldwin", "Baldwin County"], ["ga-milledgeville", "City of Milledgeville"], ["ga", "State of Georgia"]].map(([value, l]) => ({ value, label: l }));
  content.append(notice("Civic entries are factual records. Enter only what the cited source shows; leave unknown fields blank. " + docsNote, "gold", "shield"));
  const done = (msg, href) => () => { toast(msg, "success"); if (href) window.forgeNavigate(href); else window.forgeNavigate(location.pathname, { replace: true }); };

  const fBody = h("form.panel", h("h3", "Governing body"), field({ name: "jurisdiction_id", label: "Jurisdiction", type: "select", options: juris, required: true }), field({ name: "name", label: "Name", required: true, placeholder: "Board of Commissioners" }), field({ name: "official_url", label: "Official website", type: "url" }), h("button.btn.btn-blue", { type: "submit" }, "Add body"));
  bindForm(fBody, async (d) => { await post("/api/civic/bodies", d); done("Governing body added.")(); });

  const fOfficial = h("form.panel", h("h3", "Official"), field({ name: "body_id", label: "Body", type: "select", options: bodyOpts, required: true }), h("div.grid.grid-2", field({ name: "name", label: "Name", required: true }), field({ name: "office", label: "Office", required: true, placeholder: "Commissioner" })),
    h("div.grid.grid-3", field({ name: "district", label: "District" }), field({ name: "term_start", label: "Term start", type: "date" }), field({ name: "term_end", label: "Term end", type: "date" })), field({ name: "source_url", label: "Source (official roster page)", type: "url", required: true }), h("button.btn.btn-blue", { type: "submit" }, "Add official"));
  bindForm(fOfficial, async (d) => { await post("/api/civic/officials", d); done("Official added.")(); });

  const fMeeting = h("form.panel", h("h3", "Meeting"), field({ name: "body_id", label: "Body", type: "select", options: bodyOpts, required: true }), h("div.grid.grid-2", field({ name: "title", label: "Title", required: true }), field({ name: "meeting_date", label: "Date", type: "date", required: true })),
    h("div.grid.grid-2", field({ name: "meeting_type", label: "Type", type: "select", options: ["regular", "special", "called", "work_session", "hearing", "retreat"].map((v) => ({ value: v, label: label("meetingType", v) })) }), field({ name: "minutes_status", label: "Minutes", type: "select", options: ["unavailable", "draft", "approved"].map((v) => ({ value: v, label: v })) })),
    h("div.grid.grid-3", field({ name: "agenda_document_id", label: "Agenda record ID" }), field({ name: "minutes_document_id", label: "Minutes record ID" }), field({ name: "transcript_document_id", label: "Transcript record ID" })),
    h("div.grid.grid-2", field({ name: "video_url", label: "Video URL", type: "url" }), field({ name: "source_url", label: "Official meeting page", type: "url" })), h("button.btn.btn-blue", { type: "submit" }, "Add meeting"));
  bindForm(fMeeting, async (d) => { const r = await post("/api/civic/meetings", d); done("Meeting added.", `/government/meetings/${r.id}`)(); });

  const motionBox = h("div");
  const fMotion = h("form.panel", h("h3", "Motion & votes"), field({ name: "meeting_id", label: "Meeting ID", required: true, hint: "Open the meeting page; the ID is the last part of its URL." }), h("button.btn.btn-ghost.btn-sm", { type: "button", onclick: async () => {
    const id = fMotion.elements.meeting_id.value.trim(); if (!id) return;
    try { const m = await get(`/api/civic/meetings/${id}`); const body = await get(`/api/civic/bodies/${m.meeting.body_id}`); renderMotionFields(motionBox, body.officials); toast(`Loaded ${m.meeting.title}`, "success"); } catch (e) { toast(e.message, "error"); }
  } }, "Load meeting officials"), motionBox, h("button.btn.btn-blue", { type: "submit" }, "Record motion"));
  bindForm(fMotion, async (d, form) => {
    const votes = [...form.querySelectorAll("[data-vote-for]")].filter((s) => s.value).map((s) => ({ official_id: s.dataset.voteFor, vote: s.value }));
    const body = Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith("vote-")));
    await post(`/api/civic/meetings/${d.meeting_id}/motions`, { ...body, votes });
    done("Motion recorded.", `/government/meetings/${d.meeting_id}`)();
  });

  const fBudget = h("form.panel", h("h3", "Budget"), h("div.grid.grid-3", field({ name: "jurisdiction_id", label: "Jurisdiction", type: "select", options: juris, required: true }), field({ name: "fiscal_year", label: "Fiscal year", type: "number", required: true }), field({ name: "stage", label: "Stage", type: "select", options: ["adopted", "proposed", "amended", "actual"].map((v) => ({ value: v, label: v })) })),
    field({ name: "title", label: "Title", required: true }), h("div.grid.grid-2", field({ name: "document_id", label: "Budget record ID" }), field({ name: "source_url", label: "or official URL", type: "url" })),
    field({ name: "lines_csv", label: "Line items (CSV, optional)", type: "textarea", rows: 5, hint: "fund,department,line_type(revenue|expenditure),description,amount_dollars,page — one per line" }), h("button.btn.btn-blue", { type: "submit" }, "Add budget"));
  bindForm(fBudget, async (d) => {
    const lines = parseLines(d.lines_csv);
    const { lines_csv, ...rest } = d; void lines_csv;
    const r = await post("/api/civic/budgets", rest);
    if (lines.length) await post(`/api/civic/budgets/${r.id}/lines`, { lines });
    done("Budget added.", `/government/budgets/${r.id}`)();
  });

  const fReport = h("form.panel", h("h3", "Financial report / audit"), h("div.grid.grid-3", field({ name: "jurisdiction_id", label: "Jurisdiction", type: "select", options: juris, required: true }), field({ name: "fiscal_year", label: "Fiscal year", type: "number", required: true }), field({ name: "report_type", label: "Report type", required: true, placeholder: "Annual Comprehensive Financial Report" })),
    h("label", { style: { display: "flex", gap: "8px", alignItems: "center", margin: "8px 0" } }, h("input", { type: "checkbox", name: "audited" }), "Independently audited"),
    h("div.grid.grid-2", field({ name: "auditor", label: "Auditor (required if audited)" }), field({ name: "opinion", label: "Audit opinion", type: "select", options: ["not_stated", "unmodified", "qualified", "adverse", "disclaimer"].map((v) => ({ value: v, label: label("opinion", v) })) })),
    h("div.grid.grid-2", field({ name: "document_id", label: "Report record ID" }), field({ name: "source_url", label: "or official URL", type: "url" })), h("button.btn.btn-blue", { type: "submit" }, "Add report"));
  bindForm(fReport, async (d) => { await post("/api/civic/financial-reports", d); done("Financial report added.", "/government?tab=budgets")(); });

  content.append(fBody, bodyOpts.length ? fOfficial : null, bodyOpts.length ? fMeeting : null, bodyOpts.length ? fMotion : null, fBudget, fReport);
}

function renderMotionFields(box, officials) {
  const opts = [{ value: "", label: "—" }, ...officials.map((o) => ({ value: o.id, label: o.name }))];
  clear(box).append(
    h("div.grid.grid-3", field({ name: "item_number", label: "Agenda item" }), field({ name: "resolution_number", label: "Resolution / ordinance no." }), field({ name: "result", label: "Result", type: "select", options: ["unrecorded", "passed", "failed", "tabled", "withdrawn"].map((v) => ({ value: v, label: v })) })),
    field({ name: "title", label: "Motion", required: true }), field({ name: "motion_text", label: "Text", type: "textarea", rows: 3 }),
    h("div.grid.grid-2", field({ name: "moved_by", label: "Moved by", type: "select", options: opts }), field({ name: "seconded_by", label: "Seconded by", type: "select", options: opts })),
    h("div.grid.grid-2", field({ name: "supporting_document_id", label: "Supporting record ID" }), field({ name: "source_pinpoint", label: "Page / timestamp", placeholder: "Minutes p. 4 or 01:12:30" })),
    h("h4", "Votes as recorded"), h("p.small.muted", "Leave blank where the source does not record an individual vote."),
    h("div.grid.grid-2", officials.map((o) => h("label.field", h("span", o.name), h("select.select", { "data-vote-for": o.id, name: `vote-${o.id}` }, ["", "yea", "nay", "abstain", "absent", "recused"].map((v) => h("option", { value: v }, v || "— not recorded")))))));
}

function parseLines(csv) {
  if (!csv) return [];
  return csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line, i) => {
    const [fund, department, line_type, description, amount, page] = line.split(",").map((x) => x?.trim());
    const dollars = Number(String(amount || "").replace(/[$\s]/g, ""));
    if (!department || !["revenue", "expenditure"].includes(line_type) || !Number.isFinite(dollars)) throw new Error(`Line ${i + 1} is not in the expected format`);
    return { fund, department, line_type, description, amount_cents: Math.round(dollars * 100), source_pinpoint: page };
  });
}
