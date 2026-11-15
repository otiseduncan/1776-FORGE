import { h, icon } from "../core/dom.js";
import { get, post, qs } from "../core/api.js";
import { date, label, plural } from "../core/format.js";
import { pageHero, empty, pagination, setTitle, citationList, relatedList, errorBox, avatar, toast, field, bindForm, modal } from "../core/ui.js";
import { renderMarkdown, embedUrl } from "../core/markdown.js";
import { discussionPanel } from "../core/discussion.js";
import { user, can } from "../core/session.js";

export async function newsIndex({ view, query }) {
  setTitle("Investigations & Reporting");
  const page = Number(query.get("page") || 1);
  const category = query.get("category") || "";
  const kind = query.get("kind") || "";
  const tag = query.get("tag") || "";
  const [cats, data] = await Promise.all([get("/api/news/categories").catch(() => ({ items: [] })), get("/api/news" + qs({ page, category, kind, tag, q: query.get("q") })).catch((e) => ({ error: e }))]);
  view.append(pageHero({
    eyebrow: "1776 FORGE Newsroom",
    title: "Investigations & reporting",
    lede: "Evidence-backed journalism. Every story links to the records behind it, and every correction stays attached to the record.",
    actions: can("article.draft") ? h("a.btn.btn-gold", { href: "/workspace/articles/new" }, icon("edit", 18), "Write a story") : null,
  }));
  const go = (params) => window.forgeNavigate("/news" + qs({ category, kind, tag, ...params }));
  const chips = h("div.chips", { role: "group", "aria-label": "Category" },
    h("button.chip", { type: "button", "aria-pressed": String(!category), onclick: () => go({ category: "", page: 1 }) }, "All"),
    cats.items.map((c) => h("button.chip", { type: "button", "aria-pressed": String(category === c.id), onclick: () => go({ category: c.id, page: 1 }) }, c.name, c.articles ? ` (${c.articles})` : "")));
  const kinds = h("div.chips", { role: "group", "aria-label": "Story type", style: { marginTop: "10px" } },
    ["", "investigation", "report", "update", "explainer", "commentary"].map((k) => h("button.chip", { type: "button", "aria-pressed": String(kind === k), onclick: () => go({ kind: k, page: 1 }) }, k ? label("kind", k) : "All types")));
  const body = h("div.container.section", h("div.search-panel", { style: { marginBottom: "28px" } }, chips, kinds, tag && h("p.small", { style: { marginTop: "10px" } }, "Tag: ", h("strong", tag), " · ", h("a", { href: "/news" }, "clear"))));
  if (data.error) body.append(errorBox(data.error));
  else if (!data.items.length) body.append(empty({ iconName: "news", title: category || kind || tag ? "No stories match these filters" : "No stories have been published yet", text: "Stories appear here after contributors draft them and an editor reviews and publishes them. Commentary is always labelled separately from reporting." }));
  else {
    body.append(h("div.grid.grid-3", data.items.map((a) => h("article.card.interactive.card-accent",
      h("div.kicker", label("kind", a.kind), a.category_name && h("span", "· " + a.category_name), a.featured ? h("span.badge.badge-gold", "Featured") : null, a.corrections ? h("span.badge.badge-disputed", "Corrected") : null),
      h("h3", h("a", { href: `/news/${a.slug}` }, a.title)),
      a.summary && h("p", a.summary),
      h("div.card-foot", h("span", a.author ? `By ${a.author}` : ""), h("span", date(a.published_at)))))));
    body.append(pagination(page, data.pageSize, data.total, (p) => go({ page: p })));
  }
  view.append(body);
}

export async function article({ view, params }) {
  let data;
  try { data = await get(`/api/news/${encodeURIComponent(params.slug)}`); }
  catch (err) {
    if (err.status === 404) { const { notFound } = await import("./static.js"); return notFound({ view }); }
    throw err;
  }
  const a = data.article;
  setTitle(a.title);
  const isCommentary = a.kind === "commentary";
  view.append(h("section.page-hero", h("div.container.article-head",
    h("nav.breadcrumbs", { "aria-label": "Breadcrumb" }, h("a", { href: "/news" }, "Newsroom"), a.category_name ? [" / ", h("a", { href: `/news?category=${a.category_id}` }, a.category_name)] : null),
    h("div.eyebrow", isCommentary ? "Commentary — opinion" : label("kind", a.kind)),
    h("h1", a.title),
    a.summary && h("p.lede", a.summary),
    h("div.byline",
      avatar({ display_name: a.author, avatar_url: a.author_avatar }, 36),
      h("span", "By ", h("a", { href: `/authors/${a.author_id}` }, a.author || "FORGE staff")),
      h("span", "·"), h("span", a.published_at ? `Published ${date(a.published_at)}` : h("span.badge.badge-pending", `Status: ${a.status}`)),
      a.updated_at && a.published_at && a.updated_at > a.published_at ? h("span", `· Updated ${date(a.updated_at)}`) : null,
      data.versionCount > 1 ? h("span", `· ${plural(data.versionCount, "version")}`) : null))));

  const main = h("article.stack");
  if (a.status !== "published") main.append(h("div.notice.notice-warning", icon("alert", 20), h("div", `This story is a ${a.status === "review" ? "draft in editorial review" : a.status} and is not public.`)));
  if (isCommentary) main.append(h("div.notice.notice-gold", icon("info", 20), h("div", "This is FORGE commentary — analysis and opinion, clearly separated from news reporting.")));
  if (data.corrections.length) main.append(h("section.correction-box", { id: "corrections" }, h("h3", "Corrections & updates"), data.corrections.map((c) => h("p", h("strong", `${({ correction: "Correction", clarification: "Clarification", update: "Update", editors_note: "Editor's note" })[c.kind] || "Note"} (${date(c.created_at)}): `), c.body))));
  const video = a.video_url && embedUrl(a.video_url);
  if (video) main.append(h("div.video-embed", h("iframe", { src: video, title: "Embedded video", loading: "lazy", allow: "encrypted-media; picture-in-picture", allowfullscreen: true, referrerpolicy: "strict-origin-when-cross-origin" })));
  else if (a.video_url) main.append(h("p", h("a", { href: a.video_url, target: "_blank", rel: "noopener noreferrer" }, icon("external", 14), " Watch the related video")));
  main.append(renderMarkdown(a.body));
  if (a.tags?.length) main.append(h("div.chips", a.tags.map((t) => h("a.chip", { href: `/news?tag=${encodeURIComponent(t.toLowerCase().replace(/[^a-z0-9]+/g, "-"))}` }, "#", t))));

  const side = h("aside",
    h("section.panel", h("h3", icon("doc", 14), " Sources & citations"), citationList(data.citations)),
    h("section.panel", h("h3", icon("link", 14), " Related records & research"), relatedList(data.related)),
    discussionPanel({ contextType: "article", contextId: a.id, contextTitle: a.title, discussions: data.discussions }));
  if (user()) {
    const follow = h("button.btn.btn-ghost.btn-sm", { type: "button", onclick: async () => { await post("/api/follows", { target_type: "article", target_id: a.id }); toast("You'll be notified of corrections and updates.", "success"); } }, icon("bell", 16), "Follow updates");
    side.prepend(h("section.panel", h("h3", "Stay informed"), follow));
  }
  if (data.permissions.edit || data.permissions.correct) {
    const tools = h("section.panel", h("h3", icon("edit", 14), " Editorial tools"), h("div.btn-row",
      data.permissions.edit && h("a.btn.btn-ghost.btn-sm", { href: `/workspace/articles/${a.id}` }, "Edit"),
      data.permissions.correct && a.status === "published" && h("button.btn.btn-red.btn-sm", { type: "button", onclick: () => correctionDialog(a) }, "Append correction")));
    side.prepend(tools);
  }
  view.append(h("div.container.section", h("div.layout-sidebar", main, side)));
}

function correctionDialog(a) {
  const form = h("form",
    field({ name: "kind", label: "Type", type: "select", options: [{ value: "correction", label: "Correction" }, { value: "clarification", label: "Clarification" }, { value: "update", label: "Update" }, { value: "editors_note", label: "Editor's note" }] }),
    field({ name: "body", label: "Public text", type: "textarea", required: true, hint: "State what was wrong and what is correct. This is permanent and public." }),
    h("button.btn.btn-red", { type: "submit" }, "Publish correction"));
  const dlg = modal("Append a correction", form);
  bindForm(form, async (d) => { await post(`/api/news/${a.id}/corrections`, d); dlg.close(); toast("Correction published.", "success"); window.forgeNavigate(location.pathname, { replace: true }); });
}
