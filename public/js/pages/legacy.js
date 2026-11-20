import { h } from "../core/dom.js";
import { get, qs } from "../core/api.js";
import { pageHero, setTitle, notice, pagination } from "../core/ui.js";
import { renderMarkdown } from "../core/markdown.js";

export async function legacyCommunity({ view }) {
  const d = await get("/legacy-api/forum/threads?limit=100");
  setTitle("Preserved community discussions");
  view.append(pageHero({ eyebrow: "Baldwin Minute Watch · Community archive", title: "Preserved community discussions", lede: "Original public discussions remain readable with their original identifiers and moderation status. This archive is read-only during the transition." }));
  view.append(h("section.container.section", h("div.grid.grid-2", (d.threads || []).map(t => h("article.card", h("h2", { style: { fontSize: "1.25rem" } }, h("a", { href: `/legacy/community/${encodeURIComponent(t.id)}` }, t.title)), h("p", t.excerpt), h("p.small.muted", t.author)))), h("p", h("a", { href: "/community" }, "Join current community discussions"))));
}

export async function legacyThread({ view, params }) {
  const d = await get(`/legacy-api/forum/threads/${encodeURIComponent(params.id)}`);
  const t = d.thread;
  setTitle(t.title);
  view.append(pageHero({ eyebrow: "Preserved community discussion · Member opinion", title: t.title, lede: `Original thread ID: ${t.id}` }));
  const box = h("section.container.container-narrow.section", notice("This historical discussion is read-only during the transition. Member posts are opinion.", "info"), h("p.muted", t.author), h("div.prose", renderMarkdown(t.body || "")));
  for (const p of d.posts || []) box.append(h("article.panel", h("p", h("strong", p.author || "Member")), h("div.prose", renderMarkdown(p.body || ""))));
  view.append(box);
}

export async function legacyIndex({ view, query }) {
  setTitle("The Forge · Legacy collection");
  const page = Math.max(1, Number(query.get("page")) || 1);
  const q = query.get("q") || "";
  const jurisdiction = query.get("jurisdiction") || "";
  const classification = query.get('classification') || '';
  const year = query.get('year') || '';
  const entity = query.get('entity') || '';
  const status = await get("/civic-api/public-records/status");
  const jurisdictions = Object.keys(status.documents_by_jurisdiction || {});
  const scope = jurisdiction === "all" ? `&jurisdictions=${encodeURIComponent(jurisdictions.join(","))}` : jurisdiction ? `&jurisdiction=${encodeURIComponent(jurisdiction)}` : "";
  const d = await get(`/civic-api/public-records?limit=30&page=${page}&q=${encodeURIComponent(q)}${scope}&classification=${encodeURIComponent(classification)}&year=${encodeURIComponent(year)}&entity=${encodeURIComponent(entity)}`);
  view.append(pageHero({ eyebrow: "The Forge · Original collection", title: "Preserved legacy records", lede: "The original archive remains available with its existing identifiers, sources and publication review decisions. This collection is kept separate while migration is reconciled." }));
  const input = h("input.input", { name: "q", type: "search", value: q, "aria-label": "Search legacy records", placeholder: "Search the original collection" });
  const go = (p, term=q, area=jurisdiction, kind=classification, selectedYear=year) => window.forgeNavigate('/legacy/records'+qs({page:p,q:term,jurisdiction:area,classification:kind,year:selectedYear,entity:area===jurisdiction?entity:''}));
  const select = h("select.select", { "aria-label": "Legacy jurisdiction", onchange: e => go(1,q,e.target.value), style: { marginBlock: "16px", maxWidth: "420px" } }, [["", "Baldwin-area original collection"], ["all", "All archived jurisdictions"], ...jurisdictions.map(j => [j,j.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()).replace(/\bGa\b/g,"GA")])].map(([value,title])=>h("option", { value, selected:value===jurisdiction || undefined },title)));
  const box = h("section.container.section", h("form.search-bar", { onsubmit: e => { e.preventDefault(); go(1,input.value); } }, input, h("button.btn.btn-blue", { type: "submit" }, "Search")), select,
    h('div.btn-row',
      h('select.select', {'aria-label':'Archive record type',style:{maxWidth:'320px'},onchange:e=>go(1,q,jurisdiction,e.target.value)},[['','All record types'],...d.classifications.map(k=>[k,k.replaceAll('_',' ')])].map(([v,l])=>h('option',{value:v,selected:v===classification||undefined},l))),
      h('select.select', {'aria-label':'Archive year',style:{maxWidth:'180px'},onchange:e=>go(1,q,jurisdiction,classification,e.target.value)},[['','All years'],...d.years.map(y=>[String(y),String(y)]),['unknown','Date unknown']].map(([v,l])=>h('option',{value:v,selected:v===year||undefined},l)))),
    h("p.muted", { style: { marginBlock: "20px" } }, `${d.total.toLocaleString()} listed records · Original archive catalogue`),
    entity ? h('p',h('strong',d.entities.find(e=>e.id===entity)?.name||'Selected agency'),' · ',h('a',{href:'/legacy/records'},'Clear agency filter')) : null,
    h('p.small.muted',{style:{marginBottom:'20px'}},'Search covers titles, filenames, agencies, dates, source links and selected screened document text. Full OCR text is not available online.'),
    !d.items.length ? h('p','No records match these filters. Try fewer words or another year.') : null,
    h("div.grid.grid-3", (d.items || []).map(r => h("article.card", h("h2", { style: { fontSize: "1.2rem" } }, h("a", { href: `/legacy/records/${encodeURIComponent(r.id)}` }, r.title)), h("p", r.publisher || r.entity_id || "Publisher not recorded"), h("p.small", r.document_date || "Date not recorded")))));
  if (d.pages > 1) box.append(pagination(d.page, d.limit, d.total, p => go(p)));
  view.append(box);
}

export async function legacyRecord({ view, params }) {
  const d = await get(`/civic-api/archive/documents/${encodeURIComponent(params.id)}`);
  setTitle(d.title);
  const file = d.file_url?.startsWith("/api/archive/files/") ? d.file_url : null;
  const source = /^https?:\/\//.test(d.source_url || "") ? d.source_url : null;
  view.append(pageHero({ eyebrow: "The Forge · Preserved legacy record", title: d.title,
    lede: "This record retains its original identifier and the archive’s existing publication review decision." }));
  const box = h("section.container.container-narrow.section",
    h("p", h("strong", "Original record ID: "), d.id),
    h("p", h("strong", "Publisher: "), d.publisher || "Not recorded"),
    h("p", h("strong", "Document date: "), d.document_date || "Not recorded"),
    h("p", h("strong", "SHA-256: "), h("code", { style: { overflowWrap: "anywhere" } }, d.sha256 || "Not recorded")),
    h("div.btn-row",
      file && h("a.btn.btn-blue", { href: file, target: "_blank", rel: "noopener", "data-native": "" }, "Open preserved original"),
      file && h("a.btn.btn-ghost", { href: file + "?download=1", "data-native": "" }, "Download original"),
      source && h("a.btn.btn-ghost", { href: source, target: "_blank", rel: "noopener noreferrer" }, "Official source")));
  if (!file) box.append(notice(d.access?.notes?.join(" ") || "The preserved file is awaiting publication review.", "warning"));
  if (file && (d.format === "pdf" || d.media_type === "application/pdf")) {
    const page = /^#page=\d+$/.test(location.hash) ? location.hash : "";
    box.append(h("iframe", { src: file + page, title: `Original document: ${d.title}`, style: { width: "100%", height: "75vh", border: "1px solid var(--border)", marginTop: "24px" } }));
  }
  view.append(box);
}
