import { h, icon } from "../core/dom.js";
import { get } from "../core/api.js";
import { date, n, label, plural } from "../core/format.js";
import { pageHero, setTitle, empty, verificationBadge, resourceStatusBadge, notice } from "../core/ui.js";

const LEVEL_ORDER = ["federal", "state", "county", "city", "other"];

export async function jurisdictionsIndex({ view }) {
  setTitle("Jurisdictions");
  view.append(pageHero({ eyebrow: "Federal · State · County · City", title: "Jurisdiction explorer", lede: "Every record, meeting, map feature and resource belongs to a level of government. Start with the one that governs the question you're asking." }));
  const data = await get("/api/jurisdictions");
  const box = h("div.container.section");
  for (const level of LEVEL_ORDER) {
    const items = data.items.filter((j) => j.level === level);
    if (!items.length) continue;
    box.append(h("section", { style: { marginBottom: "32px" } }, h("h2", { style: { fontSize: "var(--fs-xl)" } }, label("level", level)),
      h("div.juris-tree.juris-light", items.map((j) => h("a.juris", { href: `/jurisdictions/${j.id}` },
        h("span.lvl", label("level", j.level)), h("strong", j.name),
        h("small", [plural(j.documents, "record"), plural(j.bodies, "governing body", "governing bodies"), plural(j.map_features, "map feature"), plural(j.resources, "resource")].join(" · ")))))));
  }
  if (!data.items.length) box.append(empty({ iconName: "building", title: "No jurisdictions configured" }));
  view.append(box);
}

export async function jurisdictionDetail({ view, params }) {
  let data;
  try { data = await get(`/api/jurisdictions/${encodeURIComponent(params.id)}`); }
  catch (err) { if (err.status === 404) { const { notFound } = await import("./static.js"); return notFound({ view }); } throw err; }
  const j = data.jurisdiction;
  setTitle(j.name);
  view.append(pageHero({
    crumbs: [{ label: "Jurisdictions", href: "/jurisdictions" }, data.parent && { label: data.parent.name, href: `/jurisdictions/${data.parent.id}` }].filter(Boolean),
    eyebrow: label("level", j.level), title: j.name,
    actions: h("div.btn-row",
      h("a.btn.btn-gold", { href: `/records?jurisdiction=${j.id}` }, icon("doc", 16), "Records"),
      data.mapFeatures ? h("a.btn.btn-ghost-light", { href: `/map?jurisdiction=${j.id}` }, icon("map", 16), `Map (${n(data.mapFeatures)})`) : null,
      h("a.btn.btn-ghost-light", { href: `/government?jurisdiction=${j.id}` }, icon("vote", 16), "Meetings & budgets")),
  }));
  const main = h("div.stack");
  main.append(h("section", h("h2", { style: { fontSize: "var(--fs-xl)" } }, "Recent public records"),
    data.documents.length ? h("div.grid", { style: { gap: "12px" } }, data.documents.map((d) => h("article.card.interactive",
      h("div.kicker", d.record_date ? date(d.record_date) : "Undated", d.agency_name && h("span", "· " + d.agency_name)),
      h("h3", h("a", { href: `/records/${d.id}` }, d.title)), d.summary && h("p", d.summary),
      h("div.card-foot", verificationBadge(d.verification_state), h("span", d.category_name || ""))))) : empty({ title: "No public records for this jurisdiction yet" }),
    data.documents.length ? h("p", h("a", { href: `/records?jurisdiction=${j.id}` }, "All records ", icon("arrow", 14))) : null));
  if (data.articles.length) main.append(h("section", h("h2", { style: { fontSize: "var(--fs-xl)" } }, "Baldwin Minute Watch reporting"), h("ul.related-list", data.articles.map((a) => h("li", h("a", { href: `/news/${a.slug}` }, icon("news", 16), h("span", a.title, h("span.small.muted", ` · ${date(a.published_at)}`))))))));
  const side = h("aside");
  if (data.children.length) side.append(h("section.panel", h("h3", "Within ", j.name), h("ul.related-list", data.children.map((c) => h("li", h("a", { href: `/jurisdictions/${c.id}` }, icon("building", 16), h("span", c.name, h("span.small.muted", ` · ${label("level", c.level)}`))))))));
  side.append(h("section.panel", h("h3", "Governing bodies"), data.bodies.length ? h("ul.related-list", data.bodies.map((b) => h("li", h("a", { href: `/government/bodies/${b.id}` }, icon("users", 16), h("span", b.name))))) : h("p.small.muted", "None recorded yet.")));
  side.append(h("section.panel", h("h3", "Agencies"), data.agencies.length ? h("ul.related-list", data.agencies.map((a) => h("li", a.official_url ? h("a", { href: a.official_url, target: "_blank", rel: "noopener noreferrer" }, icon("building", 16), h("span", a.name)) : h("span", a.name)))) : h("p.small.muted", "None recorded yet.")));
  side.append(h("section.panel", h("h3", "Official resources"), data.resources.length ? h("ul.related-list", data.resources.map((r) => h("li", h("a", { href: r.url, target: "_blank", rel: "noopener noreferrer" }, icon("link", 16), h("span", r.name), h("span.rel", resourceStatusBadge(r.status)))))) : h("p.small.muted", "None listed yet."),
    h("p.small", h("a", { href: "/resources" }, "Resource directory"))));
  view.append(h("div.container.section", notice("Counts and listings reflect what The Forge has archived — not everything the government has published.", "info", "info"), h("div.layout-sidebar", { style: { marginTop: "20px" } }, main, side)));
}
