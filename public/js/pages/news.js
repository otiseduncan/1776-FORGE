import { h, icon } from "../core/dom.js";
import { get, post, qs } from "../core/api.js";
import { date, label, plural } from "../core/format.js";
import { pageHero, empty, pagination, setTitle, relatedList, errorBox, avatar, toast, field, bindForm, modal, verificationBadge, notice } from "../core/ui.js";
import { renderMarkdown, embedUrl } from "../core/markdown.js";
import { discussionPanel } from "../core/discussion.js";
import { user, can } from "../core/session.js";

const KINDS = ["investigation", "report", "explainer", "commentary", "community", "personal_essay", "update"];
const JURISDICTIONS = [["", "All places"], ["ga-baldwin", "Baldwin County"], ["ga-milledgeville", "Milledgeville"], ["ga", "Georgia"], ["us", "United States"]];
const OPINION = new Set(["commentary", "personal_essay"]);

const storyDate = (a) => a.published_at || a.original_published_at;
const readTime = (a) => (a.reading_minutes ? `${a.reading_minutes} min read` : "");

function heroImg(a, cls = "story-thumb") {
  if (!a.hero_url) return null;
  return h(`div.${cls}`, h("img", { src: a.hero_url, alt: a.hero_alt || "", loading: "lazy", decoding: "async" }), a.hero_is_illustration ? h("span.thumb-tag", "Illustration") : null);
}

export function storyCard(a) {
  return h("article.card.interactive.card-accent.story-card",
    heroImg(a),
    h("div.kicker", label("kind", a.kind), a.category_name && h("span", "· " + a.category_name), a.series_title ? h("span", "· " + a.series_title) : null,
      a.featured ? h("span.badge.badge-gold", "Featured") : null, a.corrections ? h("span.badge.badge-disputed", "Corrected") : null),
    h("h3", h("a", { href: `/news/${a.slug}` }, a.title)),
    (a.excerpt || a.summary) && h("p", a.excerpt || a.summary),
    h("div.card-foot", h("span", a.byline ? `By ${a.byline}` : ""), h("span", [date(storyDate(a)), readTime(a)].filter(Boolean).join(" · "))));
}

export function leadStory(a) {
  return h("article.lead-story",
    a.hero_url ? heroImg(a, "lead-media") : h("div.lead-media.lead-media-plain", { "aria-hidden": "true" },
      h("div.lead-plate", h("span.plate-kicker", label("kind", a.kind)), h("strong", a.series_title || a.category_name || "1776 FORGE"), h("span.plate-rule"), h("span.plate-foot", "1776 FORGE · Debate the issue. Bring the documents."))),
    h("div.lead-body",
      h("div.kicker", label("kind", a.kind), a.series_title ? h("span", "· " + a.series_title) : null),
      h("h2", h("a", { href: `/news/${a.slug}` }, a.title)),
      (a.summary || a.excerpt) && h("p.lede-dark", a.summary || a.excerpt),
      h("div.small.muted", [a.byline && `By ${a.byline}`, date(storyDate(a)), readTime(a)].filter(Boolean).join(" · ")),
      h("div.btn-row", { style: { marginTop: "16px" } }, h("a.btn.btn-red.btn-sm", { href: `/news/${a.slug}` }, "Read the story", icon("arrow", 16)))));
}

export async function newsIndex({ view, query }) {
  setTitle("Newsroom");
  const f = {
    page: Number(query.get("page") || 1), category: query.get("category") || "", kind: query.get("kind") || "", tag: query.get("tag") || "",
    jurisdiction: query.get("jurisdiction") || "", q: query.get("q") || "", sort: query.get("sort") || "",
  };
  const filtered = !!(f.category || f.kind || f.tag || f.jurisdiction || f.q);
  const [cats, data, series] = await Promise.all([
    get("/api/news/categories").catch(() => ({ items: [] })),
    get("/api/news" + qs({ ...f, page: f.page })).catch((e) => ({ error: e })),
    get("/api/series").catch(() => ({ items: [] })),
  ]);
  view.append(pageHero({
    eyebrow: "1776 FORGE Newsroom",
    title: "Investigations & reporting",
    lede: "Evidence-backed journalism. Every story links to the records behind it, and every correction stays attached to the story.",
    actions: h("div.btn-row",
      series.items.length ? h("a.btn.btn-ghost-light", { href: "/news/series" }, icon("layers", 18), "Series & investigations") : null,
      can("article.draft") ? h("a.btn.btn-gold", { href: "/workspace/articles/new" }, icon("edit", 18), "Write a story") : null),
  }));
  const go = (params) => window.forgeNavigate("/news" + qs({ ...f, page: 1, ...params }));

  const search = h("form.news-search", { role: "search", onsubmit: (e) => { e.preventDefault(); go({ q: e.target.elements.q.value.trim() }); } },
    h("label.sr-only", { for: "news-q" }, "Search stories"),
    h("input.input", { id: "news-q", name: "q", type: "search", placeholder: "Search headlines, text and keywords", value: f.q, minlength: 2 }),
    h("select.select", { "aria-label": "Place", onchange: (e) => go({ jurisdiction: e.target.value }) }, JURISDICTIONS.map(([v, l]) => h("option", { value: v, selected: v === f.jurisdiction || undefined }, l))),
    h("select.select", { "aria-label": "Sort", onchange: (e) => go({ sort: e.target.value }) }, h("option", { value: "" }, "Newest first"), h("option", { value: "oldest", selected: f.sort === "oldest" || undefined }, "Oldest first")),
    h("button.btn.btn-blue", { type: "submit" }, icon("search", 16), "Search"));
  const chips = h("div.chips", { role: "group", "aria-label": "Category" },
    h("button.chip", { type: "button", "aria-pressed": String(!f.category), onclick: () => go({ category: "" }) }, "All topics"),
    cats.items.map((c) => h("button.chip", { type: "button", "aria-pressed": String(f.category === c.id), onclick: () => go({ category: c.id }) }, c.name, c.articles ? ` (${c.articles})` : "")));
  const kinds = h("div.chips", { role: "group", "aria-label": "Story type", style: { marginTop: "10px" } },
    ["", ...KINDS].map((k) => h("button.chip", { type: "button", "aria-pressed": String(f.kind === k), onclick: () => go({ kind: k }) }, k ? label("kind", k) : "All types")));
  const body = h("div.container.section", h("div.search-panel", { style: { marginBottom: "28px" } }, search, chips, kinds,
    filtered ? h("p.small", { style: { marginTop: "10px" } }, data.total !== undefined ? `${plural(data.total, "story", "stories")} found. ` : "", h("a", { href: "/news" }, "Clear all filters")) : null,
    f.tag && h("p.small", "Tag: ", h("strong", f.tag))));
  if (data.error) body.append(errorBox(data.error));
  else if (!data.items.length) body.append(empty({ iconName: "news", title: filtered ? "No stories match these filters" : "No stories have been published yet", text: "Stories appear here after an editor reviews and publishes them. Opinion and personal essays are always labelled separately from reporting." }));
  else {
    const items = [...data.items];
    if (!filtered && f.page === 1) {
      const leadIdx = Math.max(0, items.findIndex((a) => a.featured));
      body.append(leadStory(items.splice(leadIdx, 1)[0]));
    }
    if (items.length) body.append(h("div.grid.grid-3", { style: { marginTop: "28px" } }, items.map(storyCard)));
    body.append(pagination(f.page, data.pageSize, data.total, (p) => go({ page: p })));
  }
  view.append(body);
}

export async function seriesIndex({ view }) {
  setTitle("Series & investigations");
  const data = await get("/api/series");
  view.append(pageHero({ eyebrow: "1776 FORGE Newsroom", title: "Series & investigations", crumbs: [{ href: "/news", label: "Newsroom" }, { label: "Series" }],
    lede: "Long-running investigations and multi-part series, in reading order, with the records behind every installment." }));
  const body = h("div.container.section");
  if (!data.items.length) body.append(empty({ iconName: "layers", title: "No series published yet", text: "Investigations that span several stories are collected here once an editor publishes them." }));
  else body.append(h("div.grid.grid-2", data.items.map((s) => h("article.card.interactive.card-accent.story-card",
    s.hero_url ? h("div.story-thumb", h("img", { src: s.hero_url, alt: "", loading: "lazy" })) : null,
    h("div.kicker", s.kind === "investigation" ? "Investigation" : "Series", s.status !== "published" ? h("span.badge.badge-pending", label("status", s.status)) : null),
    h("h3", h("a", { href: `/news/series/${s.slug}` }, s.title)),
    s.description && h("p", s.description),
    h("div.card-foot", h("span", plural(s.published_count, "published story", "published stories")), h("span", s.last_published_at ? `Latest ${date(s.last_published_at)}` : ""))))));
  view.append(body);
}

export async function seriesPage({ view, params }) {
  let data;
  try { data = await get(`/api/series/${encodeURIComponent(params.slug)}`); }
  catch (err) { if (err.status === 404) { const { notFound } = await import("./static.js"); return notFound({ view }); } throw err; }
  const s = data.series;
  setTitle(s.title);
  view.append(pageHero({ eyebrow: s.kind === "investigation" ? "Investigation" : "Series", title: s.title, lede: s.description,
    crumbs: [{ href: "/news", label: "Newsroom" }, { href: "/news/series", label: "Series" }, { label: s.title }] }));
  const body = h("div.container.section");
  if (s.status !== "published") body.append(notice(`This series is ${label("status", s.status)} and is not public.`, "warning", "alert"));
  if (!data.items.length) body.append(empty({ iconName: "news", title: "No installments yet", text: "Stories appear here, in reading order, as they are published." }));
  else body.append(h("ol.series-list", data.items.map((a, i) => h("li",
    h("span.series-num", { "aria-hidden": "true" }, String(a.series_order || i + 1)),
    h("div",
      h("div.kicker", label("kind", a.kind), a.status !== "published" ? h("span.badge.badge-pending", label("status", a.status)) : null),
      h("h3", h("a", { href: `/news/${a.slug}` }, a.title)),
      (a.excerpt || a.summary) && h("p", a.excerpt || a.summary),
      h("div.small.muted", [a.byline && `By ${a.byline}`, date(a.published_at || a.original_published_at)].filter(Boolean).join(" · ")))))));
  view.append(body);
}

function sourceDocuments(docs) {
  return h("section.source-docs", { id: "source-documents", "aria-labelledby": "source-docs-h" },
    h("h2", { id: "source-docs-h" }, icon("doc", 20), " Source documents"),
    h("p.small.muted", "Original records preserved in the FORGE archive. Each file is stored unchanged with its SHA-256 fingerprint."),
    h("ul.doc-list", docs.map((d) => h("li",
      h("a.doc-title", { href: `/records/${d.id}` }, icon("doc", 16), d.title),
      h("div.doc-meta",
        d.document_type && h("span", label("docType", d.document_type)),
        d.record_date && h("span", date(d.record_date)),
        d.jurisdiction_name && h("span", d.jurisdiction_name),
        verificationBadge(d.verification_state),
        d.has_file ? h("span.hash", { title: d.original_sha256 }, "SHA-256 ", d.original_sha256.slice(0, 12), "…") : h("span.badge.badge-pending", "Original file not yet attached"))))));
}

function citations(list) {
  if (!list?.length) return h("p.muted.small", "No citations recorded yet.");
  return h("ol.source-list", list.map((c) => h("li", h("div",
    c.url ? h("a", { href: c.url, target: "_blank", rel: "noopener noreferrer" }, c.label, " ", icon("external", 12)) : h("strong", c.label),
    c.verified_at ? h("span.badge.badge-verified", { style: { marginLeft: "6px" } }, "Source checked") : null,
    c.document_id && h("div.small", "Archived record: ", h("a", { href: `/records/${c.document_id}` }, c.document_title || "View record")),
    c.pinpoint && h("div.small.muted", c.pinpoint),
    c.note && h("div.small.muted", c.note)))));
}

export async function article({ view, params }) {
  let data;
  try { data = await get(`/api/news/${encodeURIComponent(params.slug)}`); }
  catch (err) {
    if (err.status === 404) { const { notFound } = await import("./static.js"); return notFound({ view }); }
    throw err;
  }
  const a = data.article;
  setTitle(a.seo_title || a.title);
  const opinion = OPINION.has(a.kind);
  const updated = a.updated_at && a.published_at && a.updated_at.slice(0, 10) > a.published_at.slice(0, 10);
  view.append(h("section.page-hero", h("div.container.article-head",
    h("nav.breadcrumbs", { "aria-label": "Breadcrumb" }, h("a", { href: "/news" }, "Newsroom"), a.category_name ? [" / ", h("a", { href: `/news?category=${a.category_id}` }, a.category_name)] : null),
    h("div.eyebrow", opinion ? `${label("kind", a.kind)} — opinion` : label("kind", a.kind),
      data.series ? h("span", " · ", h("a", { href: `/news/series/${data.series.slug}` }, data.series.title), a.series_order ? `, part ${a.series_order}` : "") : null),
    h("h1", a.title),
    a.summary && h("p.lede", a.summary),
    h("div.byline",
      avatar({ display_name: a.byline, avatar_url: a.author_avatar }, 36),
      h("span", "By ", a.author_id ? h("a", { href: `/authors/${a.author_id}` }, a.byline) : a.byline),
      h("span", "·"),
      a.published_at ? h("time", { datetime: a.published_at }, `Published ${date(a.published_at)}`) : h("span.badge.badge-pending", `Status: ${label("status", a.status)}`),
      updated ? h("time", { datetime: a.updated_at }, `· Updated ${date(a.updated_at)}`) : null,
      h("span", `· ${a.reading_minutes} min read`),
      data.versionCount > 1 && data.permissions.edit ? h("span", `· ${plural(data.versionCount, "version")}`) : null))));

  if (a.hero_url) {
    view.append(h("div.container.article-hero", h("figure",
      h("img", { src: a.hero_url, alt: a.hero_alt || "", width: a.hero_width || undefined, height: a.hero_height || undefined, decoding: "async", fetchpriority: "high" }),
      (a.hero_caption || a.hero_credit || a.hero_is_illustration) && h("figcaption",
        a.hero_is_illustration ? h("strong", "Illustration. ") : null, a.hero_caption || "", a.hero_credit ? h("span.muted", ` ${a.hero_credit}`) : null))));
  }

  const main = h("article.stack.article-main");
  if (a.status !== "published") main.append(h("div.notice.notice-warning", icon("alert", 20), h("div", h("strong", "Preview. "), `This story is ${a.status === "review" ? "in editorial review" : a.status === "archived" ? "archived" : "a draft"} and is not public.`)));
  if (a.manuscript_state === "needs_manuscript") main.append(notice(h("span", h("strong", "NEEDS ORIGINAL MANUSCRIPT. "), "This is an inventory placeholder, not a story. It cannot be published until the original text is supplied."), "warning", "alert"));
  if (a.manuscript_state === "needs_evidence") main.append(notice(h("span", h("strong", "Needs supporting evidence. "), "An editor has flagged claims in this draft that still need source documents."), "warning", "alert"));
  if (opinion) main.append(h("div.notice.notice-gold", icon("info", 20), h("div", a.kind === "personal_essay" ? "This is a personal essay — reflection and opinion, clearly separated from news reporting." : "This is opinion — analysis and argument, clearly separated from news reporting.")));
  if (a.original_publisher || a.original_published_at) {
    main.append(h("aside.provenance-note", { "aria-label": "Publication history" }, icon("layers", 18), h("div",
      h("strong", "Publication history. "),
      `Originally published${a.original_publisher ? ` by ${a.original_publisher}` : ""}${a.original_published_at ? ` on ${date(a.original_published_at)}` : ""}`,
      a.original_headline && a.original_headline !== a.title ? [" under the headline ", h("em", `“${a.original_headline}”`)] : null, ". ",
      a.published_at ? `Republished by 1776 FORGE on ${date(a.published_at)}.` : "Prepared for republication by 1776 FORGE.")));
  }
  if (data.corrections.length) main.append(h("section.correction-box", { id: "corrections" }, h("h3", "Corrections & updates"), data.corrections.map((c) => h("p", h("strong", `${({ correction: "Correction", clarification: "Clarification", update: "Update", editors_note: "Editor's note" })[c.kind] || "Note"} (${date(c.created_at)}): `), c.body))));
  const video = a.video_url && embedUrl(a.video_url);
  main.append(renderMarkdown(a.body));
  if (video) main.append(h("figure.video-figure", h("div.video-embed", h("iframe", { src: video, title: `Video: ${a.title}`, loading: "lazy", allow: "encrypted-media; picture-in-picture", allowfullscreen: true, referrerpolicy: "strict-origin-when-cross-origin" })),
    h("figcaption.small.muted", "Supporting video. ", h("a", { href: a.video_url, target: "_blank", rel: "noopener noreferrer" }, "Open the original recording ", icon("external", 12)))));
  else if (a.video_url) main.append(h("p", h("a", { href: a.video_url, target: "_blank", rel: "noopener noreferrer" }, icon("external", 14), " Watch the related video")));
  if (data.documents?.length) main.append(sourceDocuments(data.documents));
  main.append(h("section.article-sources", { id: "sources" }, h("h2", icon("link", 20), " Sources & citations"), citations(data.citations)));
  if (a.tags?.length) main.append(h("div.chips", a.tags.map((t) => h("a.chip", { href: `/news?tag=${encodeURIComponent(t.toLowerCase().replace(/[^a-z0-9]+/g, "-"))}` }, "#", t))));
  if (data.permissions.edit && a.provenance_note) main.append(h("details.panel.provenance-internal", h("summary", "Import provenance (editors only)"), h("pre.small", a.provenance_note)));

  const share = h("button.btn.btn-ghost.btn-sm", { type: "button", onclick: async () => {
    const url = `${location.origin}/news/${a.slug}`;
    try { if (navigator.share) await navigator.share({ title: a.title, url }); else { await navigator.clipboard.writeText(url); toast("Link copied.", "success"); } } catch { /* cancelled */ }
  } }, icon("link", 16), "Share");
  const side = h("aside.stack",
    h("section.panel", h("h3", "This story"), h("div.btn-row", share, user() ? h("button.btn.btn-ghost.btn-sm", { type: "button", onclick: async () => { await post("/api/follows", { target_type: "article", target_id: a.id }); toast("You'll be notified of corrections and updates.", "success"); } }, icon("bell", 16), "Follow updates") : null),
      h("ul.list-plain.small", { style: { marginTop: "10px", display: "grid", gap: "4px" } },
        data.documents?.length ? h("li", h("a", { href: "#source-documents" }, plural(data.documents.length, "source document"))) : null,
        h("li", h("a", { href: "#sources" }, plural(data.citations.length, "citation"))),
        data.corrections.length ? h("li", h("a", { href: "#corrections" }, plural(data.corrections.length, "correction"))) : null)),
    data.series && data.series.installments.length > 1 ? h("section.panel", h("h3", icon("layers", 14), " ", data.series.title),
      h("ol.series-mini", data.series.installments.map((x) => h("li", x.id === a.id ? h("strong", { "aria-current": "page" }, x.title) : h("a", { href: `/news/${x.slug}` }, x.title)))),
      h("a.small", { href: `/news/series/${data.series.slug}` }, "View the whole series →")) : null,
    h("section.panel", h("h3", icon("link", 14), " Related records & research"), relatedList(data.related.filter((r) => r.type !== "document" && r.type !== "article"))),
    discussionPanel({ contextType: "article", contextId: a.id, contextTitle: a.title, discussions: data.discussions }));
  if (data.permissions.edit || data.permissions.correct) {
    side.prepend(h("section.panel", h("h3", icon("edit", 14), " Editorial tools"), h("div.btn-row",
      data.permissions.edit && h("a.btn.btn-ghost.btn-sm", { href: `/workspace/articles/${a.id}` }, "Edit"),
      data.permissions.correct && a.status === "published" && h("button.btn.btn-red.btn-sm", { type: "button", onclick: () => correctionDialog(a) }, "Append correction"))));
  }
  view.append(h("div.container.section", h("div.layout-sidebar", main, side)));
  if (data.relatedStories?.length) {
    view.append(h("section.container.section-tight.related-stories", { "aria-labelledby": "related-h" }, h("h2", { id: "related-h" }, "Related stories"), h("div.grid.grid-3", data.relatedStories.slice(0, 3).map(storyCard))));
  }
}

function correctionDialog(a) {
  const form = h("form",
    field({ name: "kind", label: "Type", type: "select", options: [{ value: "correction", label: "Correction" }, { value: "clarification", label: "Clarification" }, { value: "update", label: "Update" }, { value: "editors_note", label: "Editor's note" }] }),
    field({ name: "body", label: "Public text", type: "textarea", required: true, hint: "State what was wrong and what is correct. This is permanent and public." }),
    h("button.btn.btn-red", { type: "submit" }, "Publish correction"));
  const dlg = modal("Append a correction", form);
  bindForm(form, async (d) => { await post(`/api/news/${a.id}/corrections`, d); dlg.close(); toast("Correction published.", "success"); window.forgeNavigate(location.pathname, { replace: true }); });
}
