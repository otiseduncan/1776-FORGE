import { h, icon, clear } from "../core/dom.js";
import { get, post, patch } from "../core/api.js";
import { date, label } from "../core/format.js";
import { pageHero, setTitle, resourceStatusBadge, empty, field, bindForm, modal, toast, notice } from "../core/ui.js";
import { can } from "../core/session.js";

const LEVELS = ["", "federal", "state", "county", "municipal", "nonprofit"];

export async function resourcesPage({ view, query }) {
  setTitle("Research Resource Directory");
  view.append(pageHero({
    eyebrow: "Curated government sources",
    title: "Research resource directory",
    lede: "Know where you're going before you click. Every resource explains what you'll find there, who publishes it and when its link was last checked.",
    actions: can("resource.write") ? h("div.btn-row", h("button.btn.btn-gold", { type: "button", onclick: () => editDialog() }, icon("plus", 18), "Add resource"), h("button.btn.btn-ghost-light", { type: "button", onclick: runBatch }, icon("check", 18), "Check links")) : null,
  }));
  const state = { q: query.get("q") || "", level: query.get("level") || "", topic: query.get("topic") || "" };
  let data;
  try { data = await get("/api/resources"); } catch (e) { data = { items: [], topics: [], error: e }; }
  const topics = data.topics || [...new Set(data.items.flatMap((r) => r.topics || []))].sort();

  const results = h("div", { "aria-live": "polite" });
  const qInput = h("input.input", { type: "search", value: state.q, placeholder: "Try courts, legislation, audits, open records…", "aria-label": "Filter resources" });
  const levelChips = h("div.chips", { role: "group", "aria-label": "Government level" }, LEVELS.map((l) => h("button.chip", { type: "button", "aria-pressed": String(state.level === l), "data-level": l }, l ? label("level", l) : "All levels")));
  const topicSelect = h("select.select", { "aria-label": "Research topic", style: { maxWidth: "260px" } }, [h("option", { value: "" }, "All topics"), ...topics.map((t) => h("option", { value: t, selected: t === state.topic || undefined }, t))]);

  function render() {
    const q = state.q.toLowerCase();
    const items = data.items.filter((r) =>
      (!state.level || r.level === state.level) &&
      (!state.topic || (r.topics || []).includes(state.topic)) &&
      (!q || [r.name, r.description, r.category, ...(r.topics || [])].join(" ").toLowerCase().includes(q)));
    clear(results).append(h("div.results-meta", h("span", `${items.length} of ${data.items.length} resources`), data.source === "starter" ? h("span.badge.badge-pending", "Starter list — database not connected") : null));
    if (!items.length) { results.append(empty({ iconName: "link", title: "No resources match", text: "Try a broader term or clear the filters." })); return; }
    results.append(h("div.grid.grid-2", items.map(card)));
    history.replaceState(null, "", "/resources" + (new URLSearchParams(Object.entries(state).filter(([, v]) => v)).toString() ? "?" + new URLSearchParams(Object.entries(state).filter(([, v]) => v)) : ""));
  }

  function card(r) {
    return h("article.card.card-accent-blue",
      h("div.kicker", label("level", r.level), r.jurisdiction_name && h("span", "· " + r.jurisdiction_name), h("span", "· " + label("sourceKind", r.source_kind || "official"))),
      h("h3", h("a", { href: r.url, target: "_blank", rel: "noopener noreferrer" }, r.name, " ", icon("external", 14))),
      h("p", r.description),
      r.subpages?.length ? h("ul.list-plain", { style: { margin: "0 0 12px", display: "grid", gap: "4px" } }, r.subpages.map((s) => h("li.small", "→ ", h("a", { href: s.url, target: "_blank", rel: "noopener noreferrer" }, s.label)))) : null,
      (r.topics || []).length ? h("div.chips", { style: { gap: "6px" } }, r.topics.map((t) => h("button.chip", { type: "button", style: { padding: "2px 10px", fontSize: "0.75rem" }, onclick: () => { state.topic = t; topicSelect.value = t; render(); } }, t))) : null,
      h("div.card-foot",
        h("span", resourceStatusBadge(r.status), r.last_checked_at ? h("span.small.muted", ` checked ${date(r.last_checked_at)}`) : null),
        can("resource.write") ? h("span.btn-row",
          h("button.btn.btn-ghost.btn-sm", { type: "button", onclick: async () => { try { const res = await post(`/api/resources/${r.id}/check`); toast(`${r.name}: ${label("resource", res.status)}${res.code ? ` (HTTP ${res.code})` : ""}`, res.status === "verified" ? "success" : "error"); data = await get("/api/resources"); render(); } catch (e) { toast(e.message, "error"); } } }, "Check"),
          h("button.btn.btn-ghost.btn-sm", { type: "button", onclick: () => editDialog(r) }, "Edit")) : null),
      r.notes && can("resource.write") ? h("p.small.muted", { style: { marginTop: "8px" } }, r.notes) : null);
  }

  qInput.addEventListener("input", () => { state.q = qInput.value.trim(); render(); });
  topicSelect.addEventListener("change", () => { state.topic = topicSelect.value; render(); });
  levelChips.addEventListener("click", (e) => {
    const b = e.target.closest("[data-level]"); if (!b) return;
    state.level = b.dataset.level;
    for (const c of levelChips.children) c.setAttribute("aria-pressed", String(c === b));
    render();
  });

  view.append(h("div.container.section",
    data.error ? notice(data.error.message, "danger", "alert") : null,
    h("div.search-panel", { style: { marginBottom: "24px" } },
      h("div.search-bar", h("div.input-wrap", icon("search", 20), qInput)),
      h("div", { style: { display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "14px", alignItems: "center" } }, levelChips, topicSelect)),
    notice("Verification status reflects an automated check that the link responds. It does not endorse the content. Non-government sources are labelled.", "info", "info"),
    h("div", { style: { marginTop: "20px" } }, results)));
  render();

  async function runBatch() {
    try { const r = await post("/api/resources/check-batch"); toast(`Checked ${r.checked} links.`, "success"); data = await get("/api/resources"); render(); }
    catch (e) { toast(e.message, "error"); }
  }
}

function editDialog(r) {
  const form = h("form",
    field({ name: "name", label: "Organization / resource name", required: true, value: r?.name }),
    field({ name: "url", label: "Official website (https)", type: "url", required: true, value: r?.url }),
    field({ name: "description", label: "What researchers will find here", type: "textarea", rows: 3, required: true, value: r?.description }),
    field({ name: "category", label: "Category", required: true, value: r?.category }),
    field({ name: "level", label: "Government level", type: "select", value: r?.level, options: ["federal", "state", "county", "municipal", "nonprofit", "academic"].map((v) => ({ value: v, label: label("level", v) })) }),
    field({ name: "source_kind", label: "Source classification", type: "select", value: r?.source_kind, options: ["official", "regulatory", "nonprofit", "academic", "news", "community"].map((v) => ({ value: v, label: label("sourceKind", v) })) }),
    field({ name: "jurisdiction_id", label: "Jurisdiction ID", value: r?.jurisdiction_id, hint: "e.g. us, ga, ga-baldwin, ga-milledgeville" }),
    field({ name: "topics", label: "Research topics (comma-separated)", value: (r?.topics || []).join(", ") }),
    h("button.btn.btn-gold", { type: "submit" }, r ? "Save changes" : "Add resource"));
  const dlg = modal(r ? `Edit ${r.name}` : "Add a resource", form);
  bindForm(form, async (d) => {
    const body = { ...d, topics: (d.topics || "").split(",").map((t) => t.trim()).filter(Boolean) };
    if (r) await patch(`/api/resources/${r.id}`, body); else await post("/api/resources", body);
    dlg.close(); toast("Saved.", "success"); window.forgeNavigate("/resources", { replace: true });
  });
}
