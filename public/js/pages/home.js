import { h, icon } from "../core/dom.js";
import { get } from "../core/api.js";
import { date, label, n, plural, ago } from "../core/format.js";
import { sectionHead, empty, verificationBadge, resourceStatusBadge, setTitle, errorBox } from "../core/ui.js";
import { user, signInUrl, session } from "../core/session.js";
import { storyCard, leadStory } from "./news.js";

export async function home({ view }) {
  setTitle();
  let data;
  try { data = await get("/api/home"); }
  catch (err) { data = null; view.append(h("div.container.section-tight", errorBox(err))); }
  const s = data?.stats || {};
  const cfg = session().config;

  view.append(h("section.bmw-masthead", { "aria-labelledby": "masthead-title" },
    h("div.container.bmw-masthead-grid",
      h("div", h("div.eyebrow", "Independent civic journalism · Baldwin County & beyond"),
        h("h1#masthead-title", "BALDWIN MINUTE WATCH"),
        h("p.bmw-motto", "Debate the Issue. Bring the Documents."),
        h("p", "Follow public decisions. Read the evidence. Join the conversation.")),
      h("img.bmw-art", { src: "/assets/brand/bmw-eagle-flag.webp", width: 2000, height: 750,
        alt: "The existing Baldwin Minute Watch eagle and American flag artwork", fetchpriority: "high" }))));

  // 2. Front page — the newsroom leads the site: the featured investigation, then the latest reporting.
  const featured = data?.featured || [];
  const latest = (data?.latest || []).filter((a) => !featured.some((f) => f.id === a.id));
  const stories = [...featured, ...latest];
  const front = h("section.section.front-page", { "aria-labelledby": "front-title" }, h("div.container",
    h("div.front-head",
      h("div", h("div.eyebrow", "Baldwin Minute Watch Newsroom"), h("h2#front-title", "Featured investigations")),
      h("div.btn-row", h("a.btn.btn-ghost.btn-sm", { href: "/news/series" }, "Series"), h("a.btn.btn-gold.btn-sm", { href: "/news" }, "All reporting")))));
  if (stories.length) {
    front.firstChild.append(leadStory(stories[0]));
    if (stories.length > 1) front.firstChild.append(h("div.grid.grid-3.front-grid", stories.slice(1, 7).map(storyCard)));
  } else {
    front.firstChild.append(empty({ iconName: "news", title: "No stories are published yet", text: "Investigations appear here after editorial review, with sources and corrections attached.", actions: [h("a.btn.btn-ghost", { href: "/standards" }, "Read our editorial standards")] }));
  }
  view.append(front);
  view.append(h("section.section.section-alt", h("div.container.bmw-desks",
    h("a.card", { href: "/news" }, h("div.eyebrow", "Newsroom"), h("h2", "Recent reporting"), h("p", "Read the latest investigations, reports and clearly labelled commentary.")),
    h("a.card", { href: "/government" }, h("div.eyebrow", "Meeting Watch"), h("h2", "Follow the decisions"), h("p", "Meeting minutes, recorded votes, budgets and the source documents behind them.")),
    h("a.card", { href: "/about" }, h("div.eyebrow", "Our mission"), h("h2", "Public work. Public scrutiny."), h("p", "Independent civic reporting, open evidence and room for informed disagreement.")))));


  // 3. Hero with records search
  const q = h("input.input", { type: "search", name: "q", placeholder: "Search records, reporting, laws, meetings…", "aria-label": "Search The Forge", autocomplete: "off" });
  view.append(h("section.hero-band",
    h("div.container.hero-grid",
      h("div",
        h("div.eyebrow", "Independent · Evidence-based · Public-interest"),
        h("h2", "The Forge"), h("p.bmw-motto", "The documents behind the reporting."),
        h("p.lede", "Independent journalism, original public records, constitutional research and a free community forum — every claim connected to the evidence behind it."),
        h("div.btn-row", { style: { marginTop: "24px" } },
          h("a.btn.btn-gold", { href: "/records" }, icon("doc", 18), "Explore public records"),
          h("a.btn.btn-ghost-light", { href: "/legacy/records" }, icon("doc", 18), "Minutes & agenda packets")),
        h("div.hero-standard", h("span.seal", icon("shield", 18)), h("span", "Free to read. Free to join the conversation. No paywall on records, maps or the forum."))),
      h("form.hero-search", { role: "search", onsubmit: (e) => { e.preventDefault(); if (q.value.trim().length >= 2) window.forgeNavigate(`/search?q=${encodeURIComponent(q.value.trim())}`); } },
        h("label", { for: "home-q" }, "Search public records"),
        h("div.search-bar", h("div.input-wrap", icon("search", 20), Object.assign(q, { id: "home-q" })), h("button.btn.btn-red", { type: "submit" }, "Search")),
        h("div.quick", "Try:", ["Open Records Act", "budget", "Fourteenth Amendment", "minutes"].map((t) => h("a", { href: `/search?q=${encodeURIComponent(t)}` }, t)))))));

  // 6. Records + search
  const records = data?.records || [];
  view.append(h("section.section.section-alt", h("div.container",
    sectionHead("Inside The Forge", "Original documents with source, date, jurisdiction and verification status.", h("a.btn.btn-ghost.btn-sm", { href: "/records" }, "Search the library")),
    records.length
      ? h("div.grid.grid-3", records.map((d) => h("article.card.interactive.card-accent-blue",
          h("div.kicker", d.category_name || "Record", d.jurisdiction_name && h("span", "· " + d.jurisdiction_name)),
          h("h3", h("a", { href: `/records/${d.id}` }, d.title)),
          h("div.card-foot", h("span", d.record_date ? date(d.record_date) : "Date not recorded"), verificationBadge(d.verification_state)))))
      : empty({ iconName: "doc", title: "The archive is ready for verified records", text: "Records are added by researchers with source and file integrity checks. The legacy archive will be migrated only after an independent backup, inventory and hash reconciliation.", actions: [h("a.btn.btn-ghost", { href: "/records" }, "Open the records library")] }))));

  // 9. Community highlights
  const discussions = data?.discussions || [];
  view.append(h("section.section", h("div.container",
    sectionHead("From the community", "Free to read. Free membership to participate. Member posts are opinion, not Baldwin Minute Watch reporting.", h("a.btn.btn-ghost.btn-sm", { href: "/community" }, "Visit the forum")),
    discussions.length
      ? h("div.grid.grid-2", discussions.map((d) => h("article.card.interactive",
          h("div.kicker", d.category_name || "Discussion"),
          h("h3", h("a", { href: `/community/t/${d.id}` }, d.title)),
          h("p", d.excerpt),
          h("div.card-foot", h("span", `${d.author} · ${ago(d.last_activity_at)}`), h("span", plural(d.comment_count, "reply", "replies"))))))
      : empty({ iconName: "chat", title: "Start the first conversation", text: "Ask a question about a public record, a meeting or a road project. Bring documents and keep it civil.", actions: [user() ? h("a.btn.btn-blue", { href: "/community/new" }, "Start a discussion") : h("a.btn.btn-gold", { href: cfg?.authConfigured ? signInUrl("/community/new") : "/signin", "data-native": cfg?.authConfigured ? "" : undefined }, "Join free to post")] }))));

}
