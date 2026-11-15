import { h, icon } from "../core/dom.js";
import { get, qs } from "../core/api.js";
import { date, label, n } from "../core/format.js";
import { pageHero, setTitle, empty, errorBox, verificationBadge } from "../core/ui.js";

const GROUPS = [
  ["records", "Public records", "doc", (r) => `/records/${r.id}`],
  ["news", "FORGE reporting", "news", (r) => `/news/${r.slug}`],
  ["law", "Constitution & law", "scale", (r) => `/law/${r.id}`],
  ["meetings", "Meetings & votes", "calendar", (r) => `/government/meetings/${r.id}`],
  ["map", "Map", "pin", (r) => `/map?feature=${r.id}`],
  ["resources", "Resources", "link", (r) => r.url],
  ["community", "Community discussion", "chat", (r) => `/community/t/${r.id}`],
];

function highlight(text, q) {
  if (!text) return null;
  const s = String(text);
  const i = s.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return s.length > 240 ? s.slice(0, 240) + "…" : s;
  const start = Math.max(0, i - 80);
  return [start ? "…" : "", s.slice(start, i), h("mark", s.slice(i, i + q.length)), s.slice(i + q.length, i + q.length + 160), "…"];
}

export async function searchPage({ view, query }) {
  const q = (query.get("q") || "").trim();
  const type = query.get("type") || "";
  setTitle(q ? `Search: ${q}` : "Search");
  const input = h("input.input", { type: "search", name: "q", value: q, placeholder: "Search records, reporting, law, meetings, map…", "aria-label": "Search FORGE", autofocus: true });
  view.append(pageHero({ eyebrow: "Search everything", title: q ? `Results for “${q}”` : "Search FORGE" }));
  const box = h("div.container.section");
  view.append(box);
  box.append(h("form.search-panel", { role: "search", style: { marginBottom: "24px" }, onsubmit: (e) => { e.preventDefault(); window.forgeNavigate("/search" + qs({ q: input.value.trim(), type })); } },
    h("div.search-bar", h("div.input-wrap", icon("search", 20), input), h("button.btn.btn-gold", { type: "submit" }, "Search")),
    h("div.chips", { style: { marginTop: "12px" } }, [["", "Everything"], ...GROUPS.map(([id, l]) => [id, l])].map(([id, l]) =>
      h("button.chip", { type: "button", "aria-pressed": String(type === id), onclick: () => window.forgeNavigate("/search" + qs({ q: input.value.trim(), type: id })) }, l)))));
  if (q.length < 2) { box.append(empty({ iconName: "search", title: "What are you looking for?", text: "Search across public records, FORGE reporting, legal authorities, meetings, map features, resources and community discussion." })); return; }
  let data;
  try { data = await get("/api/search" + qs({ q, types: type })); }
  catch (e) { box.append(errorBox(e)); return; }
  box.append(h("p.results-meta", { "aria-live": "polite" }, `${n(data.total)} result${data.total === 1 ? "" : "s"}`));
  if (!data.total) { box.append(empty({ iconName: "search", title: "No matches", text: "Try fewer words, a different spelling, or browse records by jurisdiction." })); return; }
  for (const [id, title, ic, href] of GROUPS) {
    const items = data.groups[id] || [];
    if (!items.length) continue;
    box.append(h("section.search-group", h("h2", icon(ic, 20), title, h("span.small.muted", `(${items.length})`)),
      items.map((r) => h("div.result",
        h("a.title", { href: href(r), ...(id === "resources" ? { target: "_blank", rel: "noopener noreferrer" } : {}) }, r.title),
        h("div.small.muted", { style: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", marginTop: "4px" } },
          r.date ? date(r.date) : null, r.jurisdiction || r.body || null, r.citation || null, r.kind ? label("kind", r.kind) : null,
          r.verification_state ? verificationBadge(r.verification_state) : null, id === "community" ? h("span.badge", "Community opinion") : null),
        r.excerpt ? h("p", highlight(r.excerpt, q)) : null)),
      !type && items.length >= 8 ? h("p", h("a", { href: "/search" + qs({ q, type: id }) }, `More ${title.toLowerCase()} `, icon("arrow", 14))) : null));
  }
}
