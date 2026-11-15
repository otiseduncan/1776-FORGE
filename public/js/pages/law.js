import { h, icon } from "../core/dom.js";
import { get, post } from "../core/api.js";
import { date, label, roman } from "../core/format.js";
import { pageHero, setTitle, citationList, relatedList, empty, notice, field, bindForm, modal, toast, badge } from "../core/ui.js";
import { discussionPanel } from "../core/discussion.js";
import { can } from "../core/session.js";
import { linkDialog, citeDialog } from "./records.js";

const SECTIONS = [
  ["founding", "Founding documents", "The Declaration of Independence and the founding texts."],
  ["constitution", "U.S. Constitution", "The Constitution as signed in 1787, article by article."],
  ["amendment", "Bill of Rights & Amendments", "Amendments I–X (1791) and XI–XXVII, with ratification dates."],
  ["federal_statute", "Federal statutes", "Acts of Congress codified in the United States Code."],
  ["federal_case", "Federal court decisions", "Opinions of the Supreme Court and federal courts."],
  ["state_constitution", "State constitutions", "Georgia's constitution and other state charters."],
  ["state_statute", "State statutes", "Official Code of Georgia and other state law."],
  ["state_case", "State court decisions", "Opinions of the Supreme Court of Georgia and Court of Appeals."],
];

const LAYERS = [
  ["Original legal text", "The words as enacted or ratified, from the official source."],
  ["Current authority", "Law in force today, including later amendments."],
  ["Historical version", "Superseded or repealed text kept for the record."],
  ["Judicial interpretation", "What courts have held — cited to the decision."],
  ["FORGE commentary", "Our analysis, labelled and linked from the provision."],
  ["Community opinion", "Member discussion — opinion, not legal authority."],
];

export async function lawIndex({ view }) {
  setTitle("Constitution & Law");
  view.append(pageHero({
    eyebrow: "Founding documents and their legacy",
    title: "Constitution & law",
    lede: "Start with the original text from the National Archives. Follow its interpretation through official legal sources — with every layer clearly labelled.",
    actions: can("legal.write") ? h("button.btn.btn-gold", { type: "button", onclick: addAuthorityDialog }, icon("plus", 18), "Add an authority") : null,
  }));
  const data = await get("/api/law");
  const by = (cat) => data.items.filter((x) => x.category === cat);
  const nav = h("nav.legal-nav", { "aria-label": "Legal sections" }, SECTIONS.map(([id, name]) => h("a", { href: `#${id}` }, name)));
  const content = h("div.stack",
    h("section.panel", h("h3", icon("layers", 14), " How to read this section"), h("div.layer-key", LAYERS.map(([t, d]) => h("div", h("b", t), d)))),
    notice("This section provides legal information from primary sources, not legal advice for your situation.", "gold", "scale"));
  for (const [id, name, desc] of SECTIONS) {
    const items = by(id);
    const sec = h("section", { id, style: { scrollMarginTop: "100px" } }, h("h2", { style: { fontSize: "var(--fs-2xl)", marginTop: "24px" } }, name), h("p.muted", desc));
    if (!items.length) {
      sec.append(empty({ iconName: id.includes("case") ? "gavel" : "book", title: "No entries yet", text: id.includes("case") ? "Court decisions are added only with an official citation, court, date and link to the opinion. None have been entered yet." : "Researchers add authorities here with their official source." }));
    } else if (id === "amendment") {
      sec.append(h("div.amend-grid", items.map((a) => {
        const num = /amendment-(\d+)/.exec(a.id)?.[1];
        return h("a.amend", { href: `/law/${a.id}` }, h("span.num", num ? roman(Number(num)) : "I–X"), h("span", h("strong", a.title.replace(/^.*? — /, "") || a.title), h("small", [a.enacted_at ? `Ratified ${date(a.enacted_at)}` : null, a.status !== "in_force" ? label("legalStatus", a.status) : null].filter(Boolean).join(" · "))));
      })));
    } else {
      sec.append(h("div.grid.grid-2", items.map((a) => h("article.card.interactive.card-accent-gold",
        h("div.kicker", label("textKind", a.text_kind), a.status !== "in_force" && h("span", "· " + label("legalStatus", a.status))),
        h("h3", h("a", { href: `/law/${a.id}` }, a.title)),
        a.summary && h("p", a.summary),
        h("div.card-foot", h("span", a.citation || ""), h("span", a.decided_at ? date(a.decided_at) : a.enacted_at ? date(a.enacted_at) : ""))))));
    }
    content.append(sec);
  }
  view.append(h("div.container.section", h("div.legal-index", nav, content)));
}

export async function lawDetail({ view, params }) {
  let data;
  try { data = await get(`/api/law/${encodeURIComponent(params.id)}`); }
  catch (err) { if (err.status === 404) { const { notFound } = await import("./static.js"); return notFound({ view }); } throw err; }
  const a = data.authority;
  setTitle(a.short_title || a.title);
  const section = SECTIONS.find((s) => s[0] === a.category);
  view.append(pageHero({
    crumbs: [{ label: "Constitution & law", href: "/law" }, section && { label: section[1], href: `/law#${section[0]}` }].filter(Boolean),
    eyebrow: label("textKind", a.text_kind),
    title: a.title,
    lede: a.summary,
    meta: h("div.btn-row", a.citation && h("span.badge.badge-navy", a.citation), badge(a.status === "in_force" ? "verified" : a.status === "repealed" ? "repealed" : "historical", label("legalStatus", a.status)), a.jurisdiction_name && h("span.badge.badge-gold", a.jurisdiction_name)),
  }));

  const main = h("div.stack");
  main.append(h("section.panel", h("h3", icon("book", 14), " Original / official text"),
    a.body_text
      ? [h("div.prose", { style: { whiteSpace: "pre-wrap" } }, a.body_text), h("p.small.muted", "Text copied from: ", h("a", { href: a.body_text_source, target: "_blank", rel: "noopener noreferrer" }, a.body_text_source))]
      : [h("p", "Read the authoritative text at the official source. FORGE does not re-type legal text; verified copies are imported with their source and version."),
         h("div.btn-row", h("a.btn.btn-blue", { href: a.source_url, target: "_blank", rel: "noopener noreferrer" }, icon("external", 16), `Official text — ${new URL(a.source_url).hostname.replace("www.", "")}`),
           a.annotated_url && h("a.btn.btn-ghost", { href: a.annotated_url, target: "_blank", rel: "noopener noreferrer" }, icon("scale", 16), "Constitution Annotated analysis"))]));

  main.append(h("section.panel", h("h3", icon("gavel", 14), " Judicial interpretation"),
    data.layers.interpretation.length ? relatedList(data.layers.interpretation) : h("p.muted.small", "No court decisions are linked yet. Decisions are added only with official citation, court and date.")));
  main.append(h("section.panel", h("h3", icon("news", 14), " FORGE commentary"),
    data.layers.commentary.length ? relatedList(data.layers.commentary) : h("p.muted.small", "No FORGE analysis is linked to this provision yet.")));
  main.append(h("section.panel", h("h3", icon("doc", 14), " Related public records & investigations"),
    relatedList([...data.layers.records, ...data.layers.other])));

  const side = h("aside",
    h("section.panel", h("h3", icon("info", 14), " Version & dates"), h("dl.meta",
      a.version_label && [h("dt", "Version"), h("dd", a.version_label)],
      a.enacted_at && [h("dt", a.category === "amendment" ? "Ratified" : "Adopted"), h("dd", date(a.enacted_at))],
      a.effective_at && [h("dt", "Effective"), h("dd", date(a.effective_at))],
      a.repealed_at && [h("dt", "Repealed"), h("dd", date(a.repealed_at))],
      a.court && [h("dt", "Court"), h("dd", a.court)],
      a.decided_at && [h("dt", "Decided"), h("dd", date(a.decided_at))],
      h("dt", "Source"), h("dd", h("a", { href: a.source_url, target: "_blank", rel: "noopener noreferrer" }, new URL(a.source_url).hostname)))),
    h("section.panel", h("h3", "Citations"), citationList(data.citations)),
    discussionPanel({ contextType: "legal", contextId: a.id, contextTitle: a.short_title || a.title, discussions: data.discussions }));
  if (data.permissions.edit) side.prepend(h("section.panel", h("h3", icon("edit", 14), " Research tools"), h("div.btn-row",
    h("button.btn.btn-ghost.btn-sm", { type: "button", onclick: () => linkDialog("legal", a.id) }, icon("link", 16), "Link decision / record"),
    h("button.btn.btn-ghost.btn-sm", { type: "button", onclick: () => citeDialog("legal", a.id) }, icon("doc", 16), "Add citation"))));
  view.append(h("div.container.section", h("div.layout-sidebar", main, side)));
}

function addAuthorityDialog() {
  const form = h("form",
    field({ name: "category", label: "Category", type: "select", required: true, options: SECTIONS.map(([value, l]) => ({ value, label: l })) }),
    field({ name: "title", label: "Title", required: true, hint: "Official name of the act, provision or case." }),
    field({ name: "citation", label: "Official citation", hint: "Required for court decisions, e.g. 5 U.S. 137" }),
    field({ name: "court", label: "Court (decisions only)" }),
    field({ name: "decided_at", label: "Decision date (decisions only)", type: "date" }),
    field({ name: "enacted_at", label: "Enacted / ratified", type: "date" }),
    field({ name: "jurisdiction_id", label: "Jurisdiction", type: "select", options: [{ value: "us", label: "United States" }, { value: "ga", label: "Georgia" }] }),
    field({ name: "source_url", label: "Official source URL", type: "url", required: true }),
    field({ name: "summary", label: "Neutral description", type: "textarea", rows: 3, hint: "Describe what it is. Do not characterise holdings without citing the opinion." }),
    h("button.btn.btn-gold", { type: "submit" }, "Add authority"));
  const dlg = modal("Add a legal authority", form);
  bindForm(form, async (d) => { const r = await post("/api/law", d); dlg.close(); toast("Authority added.", "success"); window.forgeNavigate(`/law/${r.id}`); });
}
