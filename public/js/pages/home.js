import { h, icon } from "../core/dom.js";
import { get } from "../core/api.js";
import { date, label, n, plural, ago } from "../core/format.js";
import { sectionHead, empty, verificationBadge, resourceStatusBadge, setTitle, errorBox } from "../core/ui.js";
import { createMap, featureStyle } from "../core/map.js";
import { user, signInUrl, session } from "../core/session.js";
import { storyCard, leadStory } from "./news.js";

export async function home({ view }) {
  setTitle();
  let data;
  try { data = await get("/api/home"); }
  catch (err) { data = null; view.append(h("div.container.section-tight", errorBox(err))); }
  const s = data?.stats || {};
  const cfg = session().config;

  // 1. Masthead — the approved 1776 FORGE banner artwork.
  view.append(h("section.masthead", { "aria-label": "1776 FORGE" },
    h("div.masthead-frame", h("picture",
      h("source", { type: "image/webp", srcset: "/assets/brand/forge-banner-800.webp 800w, /assets/brand/forge-banner-1200.webp 1200w, /assets/brand/forge-banner-1672.webp 1672w", sizes: "(max-width: 1400px) 100vw, 1400px" }),
      h("img", { src: "/assets/brand/forge-banner.jpg", width: 1672, height: 467, alt: "1776 FORGE — Fellowship for Open Records and Government Examination. A bald eagle before the American flag and the Constitution's “We the People” and the Bill of Rights.", fetchpriority: "high" })))));

  // 2. Front page — the newsroom leads the site: the featured investigation, then the latest reporting.
  const featured = data?.featured || [];
  const latest = (data?.latest || []).filter((a) => !featured.some((f) => f.id === a.id));
  const stories = [...featured, ...latest];
  const front = h("section.section.front-page", { "aria-labelledby": "front-title" }, h("div.container",
    h("div.front-head",
      h("div", h("div.eyebrow", "1776 FORGE Newsroom"), h("h2#front-title", "Latest investigations")),
      h("div.btn-row", h("a.btn.btn-ghost.btn-sm", { href: "/news/series" }, "Series"), h("a.btn.btn-gold.btn-sm", { href: "/news" }, "All reporting", icon("arrow", 16))))));
  if (stories.length) {
    front.firstChild.append(leadStory(stories[0]));
    if (stories.length > 1) front.firstChild.append(h("div.grid.grid-3.front-grid", stories.slice(1, 7).map(storyCard)));
  } else {
    front.firstChild.append(empty({ iconName: "news", title: "No stories are published yet", text: "Investigations appear here after editorial review, with sources and corrections attached.", actions: [h("a.btn.btn-ghost", { href: "/standards" }, "Read our editorial standards")] }));
  }
  view.append(front);

  // 3. Hero with records search
  const q = h("input.input", { type: "search", name: "q", placeholder: "Search records, reporting, laws, meetings…", "aria-label": "Search 1776 FORGE", autocomplete: "off" });
  view.append(h("section.hero-band",
    h("div.container.hero-grid",
      h("div",
        h("div.eyebrow", "Independent · Evidence-based · Public-interest"),
        h("h1", "Debate the issue. ", h("em", "Bring the documents.")),
        h("p.lede", "Independent journalism, original public records, constitutional research and a free community forum — every claim connected to the evidence behind it."),
        h("div.btn-row", { style: { marginTop: "24px" } },
          h("a.btn.btn-gold", { href: "/records" }, icon("doc", 18), "Explore public records"),
          h("a.btn.btn-ghost-light", { href: "/map" }, icon("map", 18), "Open the map")),
        h("div.hero-standard", h("span.seal", icon("shield", 18)), h("span", "Free to read. Free to join the conversation. No paywall on records, maps or the forum."))),
      h("form.hero-search", { role: "search", onsubmit: (e) => { e.preventDefault(); if (q.value.trim().length >= 2) window.forgeNavigate(`/search?q=${encodeURIComponent(q.value.trim())}`); } },
        h("label", { for: "home-q" }, "Search the public record"),
        h("div.search-bar", h("div.input-wrap", icon("search", 20), Object.assign(q, { id: "home-q" })), h("button.btn.btn-red", { type: "submit" }, "Search")),
        h("div.quick", "Try:", ["Open Records Act", "budget", "Fourteenth Amendment", "minutes"].map((t) => h("a", { href: `/search?q=${encodeURIComponent(t)}` }, t)))))));

  // 3. Pillars with live counts
  view.append(h("div.container", h("div.pillars",
    h("a.pillar", { href: "/news" }, icon("news", 22), h("strong", "Investigations"), h("span.count", plural(s.articles || 0, "published story", "published stories")), h("p", "Reporting grounded in documents, with corrections attached to the record.")),
    h("a.pillar", { href: "/records" }, icon("doc", 22), h("strong", "Public Records"), h("span.count", `${n(s.records || 0)} records · ${n(s.verified_records || 0)} verified`), h("p", "Federal, state, county and municipal records with provenance and integrity checks.")),
    h("a.pillar", { href: "/map" }, icon("map", 22), h("strong", "Interactive Map"), h("span.count", plural((data?.map || []).reduce((t, x) => t + x.n, 0), "mapped feature")), h("p", "Roads, public projects and moderated community problem reports.")),
    h("a.pillar", { href: "/community" }, icon("users", 22), h("strong", "Community"), h("span.count", plural(s.discussions || 0, "discussion")), h("p", "A free forum for informed questions and civil disagreement.")))));

  // 6. Records + search
  const records = data?.records || [];
  view.append(h("section.section.section-alt", h("div.container",
    sectionHead("Latest public records", "Original documents with source, date, jurisdiction and verification status.", h("a.btn.btn-ghost.btn-sm", { href: "/records" }, "Search the library", icon("arrow", 16))),
    records.length
      ? h("div.grid.grid-3", records.map((d) => h("article.card.interactive.card-accent-blue",
          h("div.kicker", d.category_name || "Record", d.jurisdiction_name && h("span", "· " + d.jurisdiction_name)),
          h("h3", h("a", { href: `/records/${d.id}` }, d.title)),
          h("div.card-foot", h("span", d.record_date ? date(d.record_date) : "Date not recorded"), verificationBadge(d.verification_state)))))
      : empty({ iconName: "doc", title: "The archive is ready for verified records", text: "Records are added by researchers with source and file integrity checks. The legacy archive will be migrated only after an independent backup, inventory and hash reconciliation.", actions: [h("a.btn.btn-ghost", { href: "/records" }, "Open the records library")] }))));

  // 7. Map preview
  const mapEl = h("div.map-canvas.preview", { role: "region", "aria-label": "Map preview of Milledgeville and Baldwin County, Georgia" });
  const mapCounts = data?.map || [];
  view.append(h("section.section", h("div.container",
    sectionHead("Interactive map", "Roads, public projects and community problem reports — every condition rating cites its source.", h("a.btn.btn-ghost.btn-sm", { href: "/map" }, "Open full map", icon("arrow", 16))),
    h("div.layout-sidebar",
      h("div.map-shell", h("div.map-toolbar", h("strong", "Baldwin County, Georgia"), h("span", mapCounts.length ? plural(mapCounts.reduce((t, x) => t + x.n, 0), "feature") : "Base map · verified layers pending import")), mapEl),
      h("aside.panel",
        h("h3", "Condition legend"),
        h("div.layer-legend", ["green", "yellow", "red", "gray"].map((c) => h("div.legend-row", h("span.legend-swatch." + c), label("condition", c)))),
        h("p.small.muted", { style: { marginTop: "16px" } }, "Colors are paired with line patterns and text labels. No road condition is shown unless it is linked to a source record."),
        h("a.btn.btn-blue.btn-sm", { href: "/map#report" }, icon("pin", 16), "Report a problem"))))));

  // 8. Constitution feature
  const law = data?.law || [];
  view.append(h("section.section.section-alt", h("div.container",
    sectionHead("Constitution & Bill of Rights", "Start with the original text from the National Archives. Follow interpretation through authoritative sources.", h("a.btn.btn-ghost.btn-sm", { href: "/law" }, "Legal research", icon("arrow", 16))),
    h("div.founding", (law.length ? law : []).slice(0, 6).map((l) => h("a", { href: `/law/${l.id}` }, h("strong", l.short_title || l.title), h("span", [l.citation, l.enacted_at ? `Adopted ${date(l.enacted_at)}` : null].filter(Boolean).join(" · ") || "Primary source")))))));

  // 9. Community highlights
  const discussions = data?.discussions || [];
  view.append(h("section.section", h("div.container",
    sectionHead("From the community", "Free to read. Free membership to participate. Member posts are opinion, not FORGE reporting.", h("a.btn.btn-ghost.btn-sm", { href: "/community" }, "Visit the forum", icon("arrow", 16))),
    discussions.length
      ? h("div.grid.grid-2", discussions.map((d) => h("article.card.interactive",
          h("div.kicker", d.category_name || "Discussion"),
          h("h3", h("a", { href: `/community/t/${d.id}` }, d.title)),
          h("p", d.excerpt),
          h("div.card-foot", h("span", `${d.author} · ${ago(d.last_activity_at)}`), h("span", plural(d.comment_count, "reply", "replies"))))))
      : empty({ iconName: "chat", title: "Start the first conversation", text: "Ask a question about a public record, a meeting or a road project. Bring documents and keep it civil.", actions: [user() ? h("a.btn.btn-blue", { href: "/community/new" }, "Start a discussion") : h("a.btn.btn-gold", { href: cfg?.authConfigured ? signInUrl("/community/new") : "/signin", "data-native": cfg?.authConfigured ? "" : undefined }, "Join free to post")] }))));

  // 10. Resource highlights
  const resources = data?.resources || [];
  view.append(h("section.section.section-alt", h("div.container",
    sectionHead("Research resources", "Curated official sources — each one explained before you click.", h("a.btn.btn-ghost.btn-sm", { href: "/resources" }, "Full directory", icon("arrow", 16))),
    h("div.grid.grid-3", resources.map((r) => h("article.card",
      h("div.kicker", label("level", r.level)),
      h("h3", h("a", { href: r.url, target: "_blank", rel: "noopener noreferrer" }, r.name, " ", icon("external", 14))),
      h("p", r.description),
      h("div.card-foot", resourceStatusBadge(r.status))))))));

  // 11. Jurisdiction explorer
  view.append(h("section.section.section-navy", h("div.container",
    sectionHead("Jurisdiction explorer", "Follow government from the federal level down to your county and city."),
    h("div.juris-tree", (data?.jurisdictions || []).map((j) => h("a.juris", { href: `/jurisdictions/${j.id}` },
      h("span.lvl", label("level", j.level)), h("strong", j.name),
      h("small", `${plural(j.documents, "record")} · ${plural(j.bodies, "governing body", "governing bodies")} · ${plural(j.resources, "resource")}`)))))));

  view.append(h("section.standard-band", h("div.container",
    h("div.eyebrow.on-light", { style: { justifyContent: "center" } }, "Our standard"),
    h("blockquote", "“Debate the issue. Bring the documents.”"),
    h("div.rule"),
    h("p.muted", "Every claim deserves scrutiny. Every reader deserves access to the source."))));

  let mapHandle;
  createMap(mapEl, { zoom: 12 }).then(async (m) => {
    mapHandle = m;
    try {
      const fc = await get("/api/map/features");
      if (fc.features.length) {
        const layer = m.L.geoJSON(fc, { style: featureStyle, pointToLayer: (f, ll) => m.L.circleMarker(ll, { radius: 7, ...featureStyle(f), fillOpacity: 0.85 }) }).addTo(m.map);
        m.map.fitBounds(layer.getBounds(), { padding: [20, 20], maxZoom: 14 });
      }
    } catch { /* base map remains useful */ }
  }).catch(() => mapEl.append(h("p.muted", { style: { padding: "20px" } }, "The map could not load. Check your connection.")));
  return () => mapHandle?.destroy();
}
