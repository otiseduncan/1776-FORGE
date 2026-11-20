import { h, icon, clear } from "../core/dom.js";
import { get, post, api, qs } from "../core/api.js";
import { date, label, plural, ago } from "../core/format.js";
import { pageHero, setTitle, citationList, relatedList, joinPrompt, field, bindForm, toast, notice, empty } from "../core/ui.js";
import { createMap, featureStyle, COND_COLORS } from "../core/map.js";
import { discussionPanel } from "../core/discussion.js";
import { user, can } from "../core/session.js";
import { turnstileField } from "../core/turnstile.js";

const LAYERS = [
  ["road", "Roads & conditions", "map"],
  ["project", "Public infrastructure projects", "building"],
  ["facility", "Public facilities", "pin"],
  ["boundary", "Boundaries", "layers"],
  ["report", "Community problem reports", "flag"],
];

export async function mapPage({ view, query }) {
  setTitle("Interactive Map");
  view.append(pageHero({
    eyebrow: "Places and accountability",
    title: "Interactive map",
    actions: h("a.btn.btn-ghost-light", { href: "/legacy-map#/map", "data-native": "" }, "Open preserved community map"),
    lede: "Roads, public projects and community problem reports across Baldwin County and Milledgeville. Condition ratings appear only when they are linked to a source.",
  }));
  const jurisdictions = (await get("/api/jurisdictions").catch(() => ({ items: [] }))).items;
  const state = { layers: new Set(LAYERS.map((l) => l[0])), jurisdiction: query.get("jurisdiction") || "", condition: "", placing: false };

  const mapEl = h("div.map-canvas", { role: "region", "aria-label": "Interactive map. Use the layer list to filter; select a feature to see its details." });
  const status = h("div.map-status", { hidden: true }, h("span", ""));
  const counts = h("span", "Loading layers…");
  const detail = h("section.panel", { "aria-live": "polite" }, h("h3", icon("info", 14), " Details"), h("p.muted.small", "Select a road, project or report on the map to see its records, sources and discussion."));

  const layerList = h("div.layer-legend", LAYERS.map(([kind, text, ic]) => h("label.checkbox", h("input", { type: "checkbox", checked: true, onchange: (e) => { e.target.checked ? state.layers.add(kind) : state.layers.delete(kind); draw(); } }), icon(ic, 16), text)));
  const condSelect = h("select.select", { "aria-label": "Condition", onchange: (e) => { state.condition = e.target.value; load(); } }, [["", "All conditions"], ["green", "Good"], ["yellow", "Fair / watch"], ["red", "Poor / hazard"], ["gray", "Not rated"]].map(([v, l]) => h("option", { value: v }, l)));
  const jSelect = h("select.select", { "aria-label": "Jurisdiction", onchange: (e) => { state.jurisdiction = e.target.value; load(); } }, [h("option", { value: "" }, "All jurisdictions"), ...jurisdictions.filter((j) => j.level !== "federal").map((j) => h("option", { value: j.id, selected: j.id === state.jurisdiction || undefined }, j.name))]);

  const reportBtn = h("button.btn.btn-red.btn-sm", { type: "button", id: "report" }, icon("pin", 16), "Report a problem");
  const reportBox = h("div");
  const controls = h("aside",
    h("section.panel", h("h3", icon("layers", 14), " Layers"), layerList,
      h("h3", { style: { marginTop: "18px" } }, "Filter"), h("div.grid", { style: { gap: "8px" } }, jSelect, condSelect)),
    h("section.panel", h("h3", "Condition legend"),
      h("div.layer-legend", ["green", "yellow", "red", "gray"].map((c) => h("div.legend-row", h("span.legend-swatch." + c), label("condition", c))), h("div.legend-row", h("span.legend-swatch.report"), "Approved community report")),
      h("p.small.muted", { style: { marginTop: "10px" } }, "Patterns distinguish conditions without relying on colour. Gray means no verified rating.")),
    h("section.panel", h("h3", icon("flag", 14), " Community reports"),
      h("p.small", "Members can pin a pothole, drainage issue or hazard with photos. Reports are reviewed before they appear publicly and are labelled as community submissions."),
      user() ? reportBtn : joinPrompt("Sign in free to report a problem."), reportBox),
    detail);

  view.append(h("div.container.section",
    h("div.layout-sidebar",
      h("div", h("div.map-shell", h("div.map-toolbar", h("strong", icon("map", 16), " Baldwin County, Georgia"), counts), mapEl, status),
        h("p.small.muted", { style: { marginTop: "10px" } }, "Base map © OpenStreetMap contributors. Tap or click the map to enable scroll-zoom.")),
      controls)));

  const { map, L, destroy } = await createMap(mapEl, { zoom: 13 });
  let featureData = { type: "FeatureCollection", features: [] };
  let reportData = { type: "FeatureCollection", features: [] };
  let layer = null;
  let placingMarker = null;

  function showStatus(text) { status.hidden = !text; status.firstChild.textContent = text || ""; }

  async function load() {
    showStatus("Loading map layers…");
    try {
      const [f, r] = await Promise.all([
        get("/api/map/features" + qs({ jurisdiction: state.jurisdiction, condition: state.condition })),
        get("/api/map/reports").catch(() => ({ features: [] })),
      ]);
      featureData = f; reportData = r;
      draw();
      showStatus(f.features.length || r.features.length ? "" : "No verified map layers have been imported yet. The base map is live.");
    } catch (err) {
      showStatus(err.status === 503 ? "Map database not connected in this environment — base map only." : "Could not load map layers.");
    }
  }

  function draw() {
    if (layer) map.removeLayer(layer);
    const feats = featureData.features.filter((f) => state.layers.has(f.properties.kind));
    const reps = state.layers.has("report") && !state.condition ? reportData.features : [];
    layer = L.geoJSON({ type: "FeatureCollection", features: [...feats, ...reps] }, {
      style: featureStyle,
      pointToLayer: (f, ll) => f.properties.kind === "report"
        ? L.circleMarker(ll, { radius: 8, color: "#fff", weight: 2, fillColor: "#245a9b", fillOpacity: 0.95 })
        : L.circleMarker(ll, { radius: 9, color: "#101b2d", weight: 2, fillColor: COND_COLORS[f.properties.condition_state] || "#245a9b", fillOpacity: 0.9 }),
      onEachFeature: (f, lyr) => {
        const p = f.properties;
        const pop = h("div", h("h4", p.title), h("div.small", p.kind === "report" ? "Community report" : label("condition", p.condition_state || "gray")), h("button.btn-link", { type: "button", onclick: () => select(f) }, "View details"));
        lyr.bindPopup(pop);
        lyr.bindTooltip(p.title, { sticky: true });
        lyr.on("click", () => select(f));
        lyr.on("keypress", (e) => { if (e.originalEvent.key === "Enter") select(f); });
      },
    }).addTo(map);
    counts.textContent = `${plural(feats.length, "feature")} · ${plural(reps.length, "report")}`;
  }

  async function select(f) {
    const p = f.properties;
    clear(detail).append(h("h3", icon("info", 14), " Details"), h("div.skeleton", { style: { minHeight: "80px" } }));
    try {
      if (p.kind === "report") {
        const d = await get(`/api/map/reports/${f.id}`);
        clear(detail).append(h("h3", icon("flag", 14), " Community report"),
          h("div.community-label", icon("users", 16), "Submitted by a member and approved by moderators. Not verified Baldwin Minute Watch reporting."),
          h("h4", { style: { marginTop: "12px" } }, d.report.title),
          h("p.small.muted", `${d.report.author || "Member"} · ${ago(d.report.created_at)} · ${String(d.report.category || "other").replace("_", " ")}`),
          h("p", d.report.description),
          d.attachments.length ? h("div.grid.grid-2", d.attachments.map((a) => a.mime_type.startsWith("image/") ? h("a", { href: a.url, target: "_blank" }, h("img", { src: a.url, alt: `Evidence photo: ${a.filename}`, loading: "lazy", style: { borderRadius: "8px" } })) : h("a", { href: a.url, target: "_blank" }, icon("doc", 16), a.filename))) : null,
          discussionPanel({ contextType: "map_report", contextId: f.id, contextTitle: d.report.title, discussions: d.discussions }));
        return;
      }
      const d = await get(`/api/map/features/${f.id}`);
      const ft = d.feature;
      clear(detail).append(h("h3", icon("pin", 14), " ", ({ road: "Road", project: "Public project", facility: "Public facility", boundary: "Boundary" })[ft.kind] || ft.kind),
        h("h4", ft.title),
        h("div.btn-row", { style: { margin: "8px 0" } }, h("span.badge", h("span.cond-dot." + (ft.condition_state || "gray")), label("condition", ft.condition_state || "gray")), h("span.badge.badge-" + (ft.verification_state === "verified" ? "verified" : "unreviewed"), label("verification", ft.verification_state))),
        ft.description && h("p", ft.description),
        h("dl.meta", ft.status && [h("dt", "Project status"), h("dd", ft.status)], ft.condition_note && [h("dt", "Condition note"), h("dd", ft.condition_note)], ft.condition_observed_at && [h("dt", "Observed"), h("dd", date(ft.condition_observed_at))], ft.jurisdiction_name && [h("dt", "Jurisdiction"), h("dd", ft.jurisdiction_name)]),
        h("h3", { style: { marginTop: "16px" } }, "Sources"), citationList(d.citations),
        h("h3", { style: { marginTop: "16px" } }, "Related records"), relatedList(d.related),
        d.reports.length ? [h("h3", { style: { marginTop: "16px" } }, "Approved community reports"), h("ul.list-plain.list-rows", d.reports.map((r) => h("li", h("span", r.title), h("span.small.muted", ago(r.created_at)))))] : null,
        discussionPanel({ contextType: "map_feature", contextId: ft.id, contextTitle: ft.title, discussions: d.discussions }));
    } catch (err) {
      clear(detail).append(h("h3", "Details"), notice(err.message, "danger", "alert"));
    }
  }

  // ---- report a problem: click the map to place a pin, then describe it.
  reportBtn.addEventListener("click", () => {
    state.placing = true;
    reportBtn.disabled = true;
    showStatus("Click or tap the map where the problem is located.");
    mapEl.style.cursor = "crosshair";
    mapEl.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  map.on("click", (e) => {
    if (!state.placing) return;
    state.placing = false;
    mapEl.style.cursor = "";
    showStatus("");
    if (placingMarker) map.removeLayer(placingMarker);
    placingMarker = L.marker(e.latlng, { draggable: true, title: "New report location" }).addTo(map);
    renderReportForm(placingMarker);
  });

  function renderReportForm(marker) {
    const fileInput = h("input.input", { type: "file", name: "photo", accept: "image/png,image/jpeg,image/webp,application/pdf" });
    const form = h("form", { style: { marginTop: "12px" } },
      field({ name: "title", label: "Short title", required: true, max: 160, placeholder: "e.g. Deep pothole near crosswalk" }),
      field({ name: "category", label: "Category", type: "select", options: [["road_condition", "Road condition"], ["drainage", "Drainage / flooding"], ["safety", "Safety hazard"], ["construction", "Construction"], ["public_property", "Public property"], ["other", "Other"]].map(([value, l]) => ({ value, label: l })) }),
      field({ name: "description", label: "What did you observe?", type: "textarea", rows: 4, required: true, hint: "Describe facts you observed, with the date. Drag the pin to adjust the location." }),
      h("div.field", h("label", "Photo or document (optional, up to 10 MB)"), fileInput),
      turnstileField(),
      h("div.btn-row", h("button.btn.btn-blue", { type: "submit" }, "Submit for review"), h("button.btn.btn-ghost", { type: "button", onclick: () => { map.removeLayer(marker); clear(reportBox); reportBtn.disabled = false; } }, "Cancel")));
    bindForm(form, async (data) => {
      const ll = marker.getLatLng();
      const res = await post("/api/map/reports", { title: data.title, description: data.description, category: data.category, lat: Number(ll.lat.toFixed(6)), lng: Number(ll.lng.toFixed(6)), jurisdiction_id: state.jurisdiction || null, turnstileToken: data["cf-turnstile-response"] });
      if (fileInput.files?.[0]) {
        const fd = new FormData(); fd.append("file", fileInput.files[0]);
        await api(`/api/map/reports/${res.id}/attachments`, { method: "POST", body: fd }).catch((e) => toast("Report saved, but the attachment failed: " + e.message, "error"));
      }
      map.removeLayer(marker);
      clear(reportBox).append(notice("Thank you. Your report was submitted and will appear on the map after moderator review. You'll get a notification when it is reviewed.", "info", "check"));
      reportBtn.disabled = false;
    });
    clear(reportBox).append(form);
    form.querySelector("input")?.focus();
  }

  await load();
  const focusId = query.get("feature") || query.get("report");
  if (focusId) {
    const f = [...featureData.features, ...reportData.features].find((x) => x.id === focusId);
    if (f) { select(f); const g = L.geoJSON(f); map.fitBounds(g.getBounds(), { maxZoom: 16 }); }
  }
  if (location.hash === "#report" && user()) reportBtn.click();
  return destroy;
}

export { empty, can };
