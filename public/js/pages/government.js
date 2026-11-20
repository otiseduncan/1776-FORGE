import { h, icon } from "../core/dom.js";
import { get, qs } from "../core/api.js";
import { date, cents, n, plural, label } from "../core/format.js";
import { pageHero, setTitle, empty, notice, citationList, relatedList, pagination, badge, sectionHead, errorBox } from "../core/ui.js";
import { discussionPanel } from "../core/discussion.js";
import { embeddedMinuteRecords } from '../core/embedded-minutes.js';

const VOTE_BADGE = { yea: "verified", nay: "disputed", abstain: "pending", absent: "unreviewed", recused: "superseded" };
const RESULT_BADGE = { passed: "verified", failed: "disputed", tabled: "pending", withdrawn: "superseded", unrecorded: "unreviewed" };

export async function govIndex({ view, query }) {
  setTitle("Government: meetings, votes & budgets");
  const tab = query.get("tab") || "archive";
  const jurisdiction = query.get("jurisdiction") || "";
  const page = Number(query.get("page") || 1);
  const summary = await get("/api/civic/summary").catch((e) => ({ error: e }));
  view.append(pageHero({
    eyebrow: "Follow the decisions and the money",
    title: "Meeting Watch",
    lede: "Agendas, minutes, video and recorded votes of local governing bodies, alongside adopted budgets and audited financial reports. Every entry links to its source.",
    actions: summary.permissions?.write ? h("a.btn.btn-gold", { href: "/workspace/civic" }, icon("plus", 18), "Add civic records") : null,
  }));
  const box = h("div.container.section");
  view.append(box);
  if (summary.error) { box.append(notice(summary.error.status === 503 ? "The civic records database is not connected in this environment." : summary.error.message, "warning", "alert")); return; }
  const c = summary.counts || {};
  if (Object.values(c).some(v => v > 0)) box.append(h("div.stats.light", { style: { marginBottom: "24px" } },
    [["Governing bodies", c.bodies], ["Meetings", c.meetings], ["Motions", c.motions], ["Recorded votes", c.votes], ["Budgets", c.budgets], ["Financial reports", c.financial_reports]]
      .map(([l, v]) => h("div.stat", h("strong", n(v)), h("span", l)))));
  box.append(h('p.small.muted', 'Published minutes and packets are source documents. Individual votes appear only after source review.'));
  const go = (p) => window.forgeNavigate("/government" + qs({ tab, jurisdiction, ...p }));
  const juris = h("select.select", { "aria-label": "Jurisdiction", style: { maxWidth: "260px" }, onchange: (e) => go({ jurisdiction: e.target.value, page: 1 }) },
    [["", "All jurisdictions"], ["ga-baldwin", "Baldwin County"], ["ga-milledgeville", "City of Milledgeville"], ["ga", "State of Georgia"]].map(([v, l]) => h("option", { value: v, selected: v === jurisdiction || undefined }, l)));
  box.append(h("div", { style: { display: "flex", gap: "12px", justifyContent: "space-between", flexWrap: "wrap", margin: "24px 0 16px", alignItems: "center" } },
    h("div.tabs.meeting-tabs", { role: "tablist" }, [["archive", "Minutes & packets"], ["meetings", "Reviewed votes"], ["bodies", "Governing bodies"], ["budgets", "Budgets & audits"]].map(([id, l]) =>
      h("button.tab", { type: "button", role: "tab", "aria-selected": String(tab === id), onclick: () => go({ tab: id, page: 1 }) }, l))),
    juris));
  const panel = h("div");
  box.append(panel);
  if (tab === 'archive') {
    await archivedMeetings(panel, query, jurisdiction);
    return;
  }
  if (tab === "bodies") {
    const data = await get("/api/civic/bodies" + qs({ jurisdiction }));
    if (!data.items.length) {
      const archive = await get('/civic-api/public-records?limit=1');
      const areas = {'ga-baldwin':'baldwin-ga','ga-milledgeville':'milledgeville-ga','ga':'georgia-state'};
      const agencies = archive.entities.filter(e=>!jurisdiction || e.jurisdiction_id===areas[jurisdiction]);
      panel.append(sectionHead('Archived agencies', 'Browse the original records by their source agency. Officials and individual vote histories are added after review.'),
        h('div.grid.grid-3',agencies.map(e=>h('article.card',h('h3',h('a',{href:'/legacy/records'+qs({entity:e.id})},e.name)),h('p.small.muted',plural(e.records,'archived record')),e.source?h('a',{href:e.source,target:'_blank',rel:'noopener noreferrer'},'Official source'):null))));
      return;
    }
    panel.append(h("div.grid.grid-3", data.items.map((b) => h("article.card.interactive.card-accent-blue",
      h("div.kicker", b.jurisdiction_name), h("h3", h("a", { href: `/government/bodies/${b.id}` }, b.name)),
      h("div.card-foot", h("span", plural(b.officials, "official")), h("span", plural(b.meetings, "meeting")))))));
  } else if (tab === "budgets") {
    panel.append(h('section.panel', sectionHead('Archived budgets & audits', 'Read the source documents, including records awaiting line-item transcription.'),
      h('div.btn-row', h('a.btn.btn-blue',{href:'/legacy/records?classification=budget_document'},'Budget documents'),h('a.btn.btn-ghost',{href:'/legacy/records?classification=financial_report'},'Financial reports & audits'))));
    const data = await get("/api/civic/budgets" + qs({ jurisdiction }));
    panel.append(sectionHead("Budgets", "Adopted, proposed and amended budgets with line items transcribed from the official document."));
    panel.append(data.budgets.length ? h("div.table-wrap", h("table.data",
      h("thead", h("tr", h("th", "Fiscal year"), h("th", "Budget"), h("th", "Stage"), h("th", "Jurisdiction"), h("th.num", "Revenue"), h("th.num", "Expenditure"))),
      h("tbody", data.budgets.map((b) => h("tr", h("td", "FY", b.fiscal_year), h("td", h("a", { href: `/government/budgets/${b.id}` }, b.title)), h("td", label("stage", b.stage)), h("td", b.jurisdiction_name), h("td.num", cents(b.revenue_cents)), h("td.num", cents(b.expenditure_cents)))))))
      : empty({ iconName: "coins", title: "No budgets entered yet", text: "Budgets are added with a link to the adopted budget document. Line items are transcribed with page references." }));
    if (jurisdiction && data.budgets.length > 1) panel.append(await compareTable(jurisdiction));
    panel.append(h("div", { style: { marginTop: "32px" } }, sectionHead("Financial reports & audits", "Annual comprehensive financial reports and independent audits. Unaudited figures are labelled.")));
    panel.append(data.financialReports.length ? h("div.table-wrap", h("table.data",
      h("thead", h("tr", h("th", "FY"), h("th", "Report"), h("th", "Jurisdiction"), h("th", "Audit status"), h("th", "Opinion"), h("th", "Source"))),
      h("tbody", data.financialReports.map((f) => h("tr", h("td", f.fiscal_year), h("td", f.report_type), h("td", f.jurisdiction_name),
        h("td", f.audited ? badge("verified", `Audited — ${f.auditor}`) : badge("pending", "Unaudited")), h("td", label("opinion", f.opinion)),
        h("td", f.document_id ? h("a", { href: `/records/${f.document_id}` }, "Record") : f.source_url ? h("a", { href: f.source_url, target: "_blank", rel: "noopener noreferrer" }, "Official source ", icon("external", 12)) : "—"))))))
      : empty({ iconName: "coins", title: "No financial reports entered yet", text: "Georgia local governments file audits with the Department of Audits and Accounts; links appear here once recorded." }));
  } else {
    const data = await get("/api/civic/meetings" + qs({ jurisdiction, page }));
    if (!data.items.length) { panel.append(empty({ iconName: "calendar", title: "Votes have not been transcribed yet", text: "The archived minutes and packets are available in Meeting Watch. Individual motions and votes will appear here after source review.", actions: [h('a.btn.btn-blue', { href: '/government' }, 'Read minutes & packets')] })); return; }
    panel.append(h("div.grid", { style: { gap: "12px" } }, data.items.map(meetingCard)));
    panel.append(pagination(page, data.pageSize, data.total, (p) => go({ page: p })));
  }
}

async function archivedMeetings(panel, query, jurisdiction) {
  const q = query.get('q') || '';
  const year = query.get('year') || 'all';
  const page = Math.max(1, Number(query.get('page')) || 1);
  const go = patch => window.forgeNavigate('/government' + qs({ jurisdiction, q, year, ...patch }));
  try {
    const videos = await get('/api/civic/videos');
    panel.append(h('section.section-tight', sectionHead('The Minute Watch Breakdown', 'Our meeting coverage, alongside the original public records.'),
      ...videos.items.map(v=>h('article.panel.meeting-video-card', {id:v.id},
        h('div', h('h2',v.title), h('p.small.muted', 'Baldwin Minute Watch reporting · Official minutes and packets are listed below.'),
          h('p',h('a',{href:v.url,target:'_blank',rel:'noopener noreferrer'},'Watch on YouTube'))),
        h('div.video-embed', h('iframe',{src:v.embed_url,title:v.title,loading:'lazy',allowfullscreen:true,referrerpolicy:'strict-origin-when-cross-origin'}))))));
  } catch(e) { panel.append(notice('Meeting videos could not load. Please try again.', 'warning')); }
  const input = h('input.input', { type: 'search', value: q, 'aria-label': 'Search meeting dates and titles', placeholder: 'Meeting title or date (YYYY-MM-DD)' });
  panel.append(h('form.search-panel', { role: 'search', onsubmit: e => { e.preventDefault(); go({q: input.value.trim(), page: 1}); } },
    h('div.search-bar', h('div.input-wrap', icon('search', 20), input), h('button.btn.btn-blue', {type:'submit'}, 'Find meetings'))));
  if (jurisdiction && jurisdiction !== 'ga-baldwin') {
    const area = jurisdiction === 'ga-milledgeville' ? 'milledgeville-ga' : 'georgia-state';
    panel.append(notice('This meeting calendar covers the Baldwin County Commission. Browse source documents for the selected jurisdiction below.'));
    panel.append(h('div.btn-row', h('a.btn.btn-blue', {href:'/legacy/records'+qs({jurisdiction:area,q,classification:'meeting_minutes'})}, 'Browse minutes'), h('a.btn.btn-ghost', {href:'/legacy/records'+qs({jurisdiction:area,q,classification:'meeting_agenda'})}, 'Browse agendas')));
    return;
  }
  let data;
  try { data = await get('/civic-api/commission/meetings' + qs({year,q,page})); }
  catch(e) { panel.append(errorBox(e)); return; }
  panel.append(h('div.btn-row', {style:{marginBlock:'18px'}}, h('select.select', { 'aria-label':'Meeting year', onchange:e=>go({year:e.target.value,page:1}), style:{maxWidth:'220px'} },
    [['all','All years'], ...data.years.slice().sort().reverse().map(y=>[y,y])].map(([v,l])=>h('option',{value:v,selected:String(v)===year||undefined},l))),
    h('a.btn.btn-ghost.btn-sm', {href:'/legacy/records?classification=meeting_minutes'}, 'All archived minutes'),
    h('a.btn.btn-ghost.btn-sm', {href:'/legacy/records?classification=meeting_packet'}, 'All agenda packets')));
  panel.append(h('p.small.muted', `${n(data.total)} calendar entries · Collection through ${data.through_date}. Availability notes reflect that collection date. Search the archive for document text.`));
  if (!data.items.length) panel.append(empty({title:'No calendar entries match',text:'Try another year or search the full archive.',actions:[h('a.btn.btn-blue',{href:'/legacy/records'+qs({q})},'Search archived documents')]}));
  panel.append(h('div.grid', {style:{gap:'12px'}}, data.items.map(m => h('article.card',
    h('div.kicker', date(m.date), m.cancelled ? ' · Cancelled' : null), h('h3',m.title),
    h('div.btn-row',m.documents.map(d=>h('a.btn.btn-ghost.btn-sm',{href:'/legacy/records/'+encodeURIComponent(d.id)},d.classification==='meeting_minutes'?'Minutes':d.classification==='meeting_agenda'?'Agenda':d.classification==='meeting_packet'?'Agenda packet':'Source document'))),
    ...Object.entries(m.document_status || {}).map(([kind,s]) => h('p.small.muted', {style:{marginTop:'10px'}}, `${kind === 'packet' ? 'Packet' : kind === 'minutes' ? 'Minutes' : kind}: ${s.status}`,
      s.embedded_in ? [' · ',h('a',{
        href: embeddedMinuteRecords[s.embedded_in.sha256] ? '/legacy/records/'+embeddedMinuteRecords[s.embedded_in.sha256]+'#page='+s.embedded_in.pdf_page : s.embedded_in.source_url+'#page='+s.embedded_in.pdf_page,
        ...(embeddedMinuteRecords[s.embedded_in.sha256] ? {} : {target:'_blank',rel:'noopener noreferrer'})
      },`Open source, PDF page ${s.embedded_in.pdf_page}`)] : null)),
    h('p.small', {style:{marginTop:'12px'}}, h('a',{href:m.source_url,target:'_blank',rel:'noopener noreferrer'},'Official meeting page'))))));
  panel.append(pagination(page,30,data.total,p=>go({page:p})));
  try {
    const news = await get('/api/news');
    const reports = news.items.filter(a=>a.video_url);
    if(reports.length) panel.append(h('section.section-tight',sectionHead('Meeting reporting & video','Baldwin Minute Watch reporting is separate from official minutes.'),h('div.grid.grid-2',reports.map(a=>h('article.card',h('h3',h('a',{href:'/news/'+a.slug},a.title)),h('p',a.summary))))));
  } catch { /* Calendar remains available if newsroom is temporarily offline. */ }
}

function meetingCard(m) {
  const sources = [m.agenda_document_id && "Agenda", m.minutes_document_id && "Minutes", m.transcript_document_id && "Transcript", m.video_url && "Video"].filter(Boolean);
  return h("article.card.interactive",
    h("div.kicker", h("span", icon("calendar", 12), " ", date(m.meeting_date)), h("span", "· " + m.body_name), h("span", "· " + label("meetingType", m.meeting_type))),
    h("h3", h("a", { href: `/government/meetings/${m.id}` }, m.title)),
    h("div.card-foot", h("span.btn-row", { style: { gap: "6px" } }, sources.map((s) => h("span.badge.badge-navy", s)), m.minutes_status === "draft" ? badge("pending", "Draft minutes") : null), h("span", plural(m.motions, "motion"))));
}

async function compareTable(jurisdiction) {
  const data = await get("/api/civic/budgets/compare" + qs({ jurisdiction }));
  if (data.years.length < 2) return h("div");
  const wrap = h("section", { style: { marginTop: "24px" } }, h("h3", "Fiscal-year comparison (adopted)"));
  wrap.append(h("div.table-wrap", h("table.data",
    h("thead", h("tr", h("th", "Department"), h("th", "Type"), data.years.map((y) => h("th.num", "FY", y)), h("th.num", "Change"))),
    h("tbody", data.rows.map((r) => {
      const first = r.amounts[data.years[0]], last = r.amounts[data.years[data.years.length - 1]];
      const change = first && last ? ((last - first) / Math.abs(first)) * 100 : null;
      return h("tr", h("td", r.department), h("td", r.line_type), data.years.map((y) => h("td.num", cents(r.amounts[y]))), h("td.num", change === null ? "—" : `${change > 0 ? "+" : ""}${change.toFixed(1)}%`));
    })))));
  wrap.append(h("p.small.muted", "Departments missing in a year show —. Change compares the first and last year shown. Figures are transcribed from adopted budgets; check the linked source documents."));
  return wrap;
}

async function load(url, view) {
  try { return await get(url); }
  catch (err) { if (err.status === 404) { const { notFound } = await import("./static.js"); notFound({ view }); return null; } throw err; }
}

export async function meetingDetail({ view, params }) {
  const data = await load(`/api/civic/meetings/${encodeURIComponent(params.id)}`, view);
  if (!data) return;
  const m = data.meeting;
  setTitle(m.title);
  view.append(pageHero({
    crumbs: [{ label: "Government", href: "/government" }, { label: m.body_name, href: `/government/bodies/${m.body_id}` }],
    eyebrow: `${label("meetingType", m.meeting_type)} meeting · ${date(m.meeting_date)}`,
    title: m.title,
    meta: h("div.btn-row", m.minutes_status === "approved" ? badge("verified", "Approved minutes") : m.minutes_status === "draft" ? badge("pending", "Draft minutes") : badge("unreviewed", "Minutes not available")),
  }));
  const sources = h("section.panel", h("h3", icon("doc", 14), " Meeting records"), h("ul.related-list",
    [["Agenda", m.agenda_document_id, m.agenda_title], ["Minutes", m.minutes_document_id, m.minutes_title], ["Transcript", m.transcript_document_id, m.transcript_title]].filter(([, id]) => id)
      .map(([l, id, t]) => h("li", h("a", { href: `/records/${id}` }, icon("doc", 16), h("span", h("span.small.muted", l, " · "), t || "View record")))),
    m.video_url ? h("li", h("a", { href: m.video_url, target: "_blank", rel: "noopener noreferrer" }, icon("eye", 16), h("span", "Meeting video"))) : null,
    m.source_url ? h("li", h("a", { href: m.source_url, target: "_blank", rel: "noopener noreferrer" }, icon("external", 16), h("span", "Official meeting page"))) : null));
  const motions = h("section", h("h2", { style: { fontSize: "var(--fs-xl)" } }, "Motions & recorded votes"));
  if (!data.motions.length) motions.append(empty({ iconName: "vote", title: "No motions recorded", text: "Motions are entered from the approved minutes or video with a page or timestamp reference." }));
  for (const mo of data.motions) {
    motions.append(h("article.card", { style: { marginBottom: "12px" } },
      h("div.kicker", mo.item_number && h("span", `Item ${mo.item_number}`), mo.resolution_number && h("span", `· ${mo.resolution_number}`)),
      h("h3", mo.title),
      mo.motion_text && h("p", mo.motion_text),
      h("div.btn-row", badge(RESULT_BADGE[mo.result] || "unreviewed", label("result", mo.result)), mo.moved_by_name && h("span.small", `Moved by ${mo.moved_by_name}`), mo.seconded_by_name && h("span.small", `· seconded by ${mo.seconded_by_name}`)),
      mo.votes.length ? h("ul.vote-list", mo.votes.map((v) => h("li", h("a", { href: `/government/officials/${v.official_id}` }, v.name), h("span.small.muted", ` ${v.office} `), badge(VOTE_BADGE[v.vote] || "unreviewed", label("vote", v.vote))))) : h("p.small.muted", "Individual votes were not recorded in the source."),
      h("p.small.muted", "Source: ", mo.supporting_document_id ? h("a", { href: `/records/${mo.supporting_document_id}` }, mo.supporting_document_title || "supporting record") : "meeting minutes / video", mo.source_pinpoint ? ` — ${mo.source_pinpoint}` : "")));
  }
  view.append(h("div.container.section", h("div.layout-sidebar",
    h("div.stack", motions),
    h("aside", sources, h("section.panel", h("h3", "Citations"), citationList(data.citations)), h("section.panel", h("h3", "Related"), relatedList(data.related)),
      discussionPanel({ contextType: "meeting", contextId: m.id, contextTitle: m.title, discussions: data.discussions })))));
}

export async function bodyDetail({ view, params }) {
  const data = await load(`/api/civic/bodies/${encodeURIComponent(params.id)}`, view);
  if (!data) return;
  const b = data.body;
  setTitle(b.name);
  view.append(pageHero({ crumbs: [{ label: "Government", href: "/government?tab=bodies" }], eyebrow: b.jurisdiction_name, title: b.name,
    actions: b.official_url ? h("a.btn.btn-ghost-light", { href: b.official_url, target: "_blank", rel: "noopener noreferrer" }, icon("external", 16), "Official website") : null }));
  const current = data.officials.filter((o) => !o.term_end || o.term_end >= new Date().toISOString().slice(0, 10));
  const former = data.officials.filter((o) => !current.includes(o));
  const people = (list) => h("ul.related-list", list.map((o) => h("li", h("a", { href: `/government/officials/${o.id}` }, icon("users", 16), h("span", o.name, h("span.small.muted", ` · ${o.office}${o.district ? `, ${o.district}` : ""}`))))));
  view.append(h("div.container.section", h("div.layout-sidebar",
    h("div.stack", h("h2", { style: { fontSize: "var(--fs-xl)" } }, "Meetings"), data.meetings.length ? h("div.grid", { style: { gap: "12px" } }, data.meetings.map((m) => meetingCard({ ...m, body_name: b.name, agenda_document_id: null }))) : empty({ iconName: "calendar", title: "No meetings recorded yet" })),
    h("aside", h("section.panel", h("h3", "Current members"), current.length ? people(current) : h("p.small.muted", "No members recorded.")),
      former.length ? h("section.panel", h("h3", "Former members"), people(former)) : null))));
}

export async function officialDetail({ view, params }) {
  const data = await load(`/api/civic/officials/${encodeURIComponent(params.id)}`, view);
  if (!data) return;
  const o = data.official;
  setTitle(o.name);
  view.append(pageHero({ crumbs: [{ label: "Government", href: "/government?tab=bodies" }, { label: o.body_name, href: `/government/bodies/${o.body_id}` }], eyebrow: o.office + (o.district ? ` · ${o.district}` : ""), title: o.name,
    lede: [o.term_start && `Term from ${date(o.term_start)}`, o.term_end && `to ${date(o.term_end)}`].filter(Boolean).join(" ") || null }));
  view.append(h("div.container.section",
    h("div.stats.light", { style: { marginBottom: "24px" } }, ["yea", "nay", "abstain", "absent", "recused"].map((k) => h("div.stat", h("strong", n(data.tally[k] || 0)), h("span", label("vote", k))))),
    notice("This record lists only votes Baldwin Minute Watch has entered from official minutes, transcripts or video. It is not a complete voting history.", "info", "info"),
    data.votes.length ? h("div.table-wrap", { style: { marginTop: "16px" } }, h("table.data", h("thead", h("tr", h("th", "Date"), h("th", "Motion"), h("th", "Vote"), h("th", "Result"))),
      h("tbody", data.votes.map((v) => h("tr", h("td", h("a", { href: `/government/meetings/${v.meeting_id}` }, date(v.meeting_date))), h("td", v.title, v.resolution_number ? h("span.small.muted", ` (${v.resolution_number})`) : null), h("td", badge(VOTE_BADGE[v.vote], label("vote", v.vote))), h("td", label("result", v.result)))))))
      : h("div", { style: { marginTop: "16px" } }, empty({ iconName: "vote", title: "No votes recorded yet" })),
    h("p.small.muted", { style: { marginTop: "16px" } }, "Source for office and term: ", h("a", { href: o.source_url, target: "_blank", rel: "noopener noreferrer" }, o.source_url))));
}

export async function budgetDetail({ view, params }) {
  const data = await load(`/api/civic/budgets/${encodeURIComponent(params.id)}`, view);
  if (!data) return;
  const b = data.budget;
  setTitle(b.title);
  view.append(pageHero({ crumbs: [{ label: "Government", href: "/government?tab=budgets" }], eyebrow: `${b.jurisdiction_name} · FY ${b.fiscal_year} · ${label("stage", b.stage)}`, title: b.title,
    actions: h("div.btn-row", b.document_id ? h("a.btn.btn-gold", { href: `/records/${b.document_id}` }, icon("doc", 16), "Budget document") : null, b.source_url ? h("a.btn.btn-ghost-light", { href: b.source_url, target: "_blank", rel: "noopener noreferrer" }, icon("external", 16), "Official source") : null) }));
  const totals = { revenue: 0, expenditure: 0 };
  for (const l of data.lines) totals[l.line_type] += Number(l.amount_cents);
  const main = h("div.stack", h("div.stats.light", h("div.stat", h("strong", cents(totals.revenue)), h("span", "Revenue")), h("div.stat", h("strong", cents(totals.expenditure)), h("span", "Expenditure")), h("div.stat", h("strong", cents(totals.revenue - totals.expenditure)), h("span", "Difference"))));
  main.append(data.lines.length ? h("div.table-wrap", h("table.data", h("thead", h("tr", h("th", "Fund"), h("th", "Department"), h("th", "Type"), h("th", "Description"), h("th.num", "Amount"), h("th", "Page"))),
    h("tbody", data.lines.map((l) => h("tr", h("td", l.fund), h("td", l.department), h("td", l.line_type), h("td", l.description || ""), h("td.num", cents(l.amount_cents)), h("td.small", l.source_pinpoint || ""))))))
    : empty({ iconName: "coins", title: "No line items transcribed yet", text: "The budget document is linked; line items will be entered with page references." }));
  view.append(h("div.container.section", h("div.layout-sidebar", main,
    h("aside", h("section.panel", h("h3", "Citations"), citationList(data.citations)), discussionPanel({ contextType: "budget", contextId: b.id, contextTitle: b.title, discussions: data.discussions })))));
}

