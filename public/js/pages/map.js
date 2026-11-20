import { h, icon, clear } from "../core/dom.js";
import { get, post, api, qs } from "../core/api.js";
import { date, label, plural, ago } from "../core/format.js";
import { pageHero, setTitle, citationList, relatedList, joinPrompt, field, bindForm, toast, notice, empty, modal } from "../core/ui.js";
import { createMap, featureStyle, COND_COLORS } from "../core/map.js";
import { discussionPanel } from "../core/discussion.js";
import { user, can } from "../core/session.js";
import { turnstileField } from "../core/turnstile.js";
import { projectPreview, projectCost, importedProjectDetails } from '../core/project-map.js';

const LAYERS = [
  ["road", "Road records", "map"],
  ["project", "Recorded projects", "building"],
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
    lede: "Explore the roads and public projects we have recorded in Baldwin County and surrounding counties. Search by project, contractor or county, then select an icon for costs, sources and details.",
  }));
  const countyGeo = await get('/data/project-counties.json');
  const state = { layers: new Set(LAYERS.map((l) => l[0])), jurisdiction: query.get("jurisdiction") || "", county:query.get('county')||'', q:query.get('q')||'', condition: query.get('condition')||'', placing: false, listPage:1 };
  let searchTimer;
  let selectedId=query.get('feature')||query.get('report')||null;

  const mapEl = h("div.map-canvas", { role: "region", "aria-label": "Interactive map. Use the layer list to filter; select a feature to see its details." });
  const status = h("div.map-status", { hidden: true }, h("span", ""));
  const counts = h("span", "Loading layers…");
  const listing = h('section.project-map-list',{'aria-label':'Recorded projects and roads','aria-live':'polite'});
  const detail = h("section.panel", { "aria-live": "polite" }, h("h3", icon("info", 14), " Details"), h("p.muted.small", "Select a road, project or report on the map to see its records, sources and discussion."));

  const layerList = h("div.layer-legend", LAYERS.map(([kind, text, ic]) => h("label.checkbox", h("input", { type: "checkbox", checked: true, onchange: (e) => { e.target.checked ? state.layers.add(kind) : state.layers.delete(kind); draw(); } }), icon(ic, 16), text)));
  const condSelect = h("select.select", { "aria-label": "Condition", onchange: (e) => { state.condition = e.target.value;state.listPage=1; load(); } }, [["", "All conditions"], ["green", "Good"], ["yellow", "Fair / watch"], ["red", "Poor / hazard"], ["gray", "Not rated"]].map(([v, l]) => h("option", { value: v,selected:v===state.condition||undefined }, l)));
  const jSelect = h("select.select", { "aria-label": "Project county", onchange: (e) => { state.county=e.target.value;state.jurisdiction='';state.listPage=1;load(true); } }, [h("option", { value: "" }, "All recorded counties"), ...countyGeo.features.slice().sort((a,b)=>a.properties.NAME.localeCompare(b.properties.NAME)).map(f=>h('option',{value:f.properties.GEOID,selected:f.properties.GEOID===state.county||undefined},f.properties.NAME+' County'))]);
  const searchInput=h('input.input',{type:'search',value:state.q,placeholder:'Project, road, contractor or cost','aria-label':'Search map projects',oninput:e=>{clearTimeout(searchTimer);state.q=e.target.value;state.listPage=1;searchTimer=setTimeout(()=>load(true),250);}});

  const reportBtn = h("button.btn.btn-red.btn-sm", { type: "button", id: "report" }, icon("pin", 16), "Report a problem");
  const reportBox = h("div");
  const controls = h("aside",
    h("section.panel", h("h3", icon("layers", 14), " Layers"), layerList,
      h("h3", { style: { marginTop: "18px" } }, "Search & filter"), h("div.grid", { style: { gap: "8px" } }, searchInput,jSelect, condSelect,
        h('button.btn.btn-ghost.btn-sm',{type:'button',onclick:()=>fitResults()},'Fit visible records'))),
    detail,
    h("section.panel", h("h3", "Condition legend"),
      h("div.layer-legend", ["green", "yellow", "red", "gray"].map((c) => h("div.legend-row", h("span.legend-swatch." + c), label("condition", c))), h("div.legend-row", h("span.legend-swatch.report"), "Approved community report")),
      h("p.small.muted", { style: { marginTop: "10px" } }, "Project and road icons open recorded details. Gold county buttons open directories for records without saved site locations. Colored condition lines apply only to sourced ratings; imported records retain their historical observations.")),
    h("section.panel", h("h3", icon("flag", 14), " Community reports"),
      h("p.small", "Members can pin a pothole, drainage issue or hazard with photos. Reports are reviewed before they appear publicly and are labelled as community submissions."),
      user() ? reportBtn : joinPrompt("Sign in free to report a problem."), reportBox),
    );

  const filters=controls.firstElementChild;
  filters.classList.add('project-map-filters');
  view.append(h("div.container.section",filters,
    h("div.layout-sidebar.project-map-layout",
      h("div", h("div.map-shell", h("div.map-toolbar", h("strong", icon("map", 16), " Recorded public projects"), counts), mapEl, status),
        h("p.small.muted", { style: { marginTop: "10px" } }, "Base map © OpenStreetMap contributors. Hover for a summary; click or tap for full details. Approximate road references are not surveyed work limits."),listing),
      controls)));

  const { map, L, destroy } = await createMap(mapEl, { zoom: 13 });
  let featureData = { type: "FeatureCollection", features: [] };
  let reportData = { type: "FeatureCollection", features: [] };
  let layer = null;
  let placingMarker = null;
  let directoryLayer = null;
  let requestToken=0;
  let visibleFeatures=[];

  const countyLayer=L.geoJSON(countyGeo,{style:{color:'#8d793f',weight:1,fillOpacity:0.025},onEachFeature:(f,lyr)=>{
    lyr.bindTooltip(f.properties.NAME+' County');
    lyr.on('click',()=>{state.county=f.properties.GEOID;state.jurisdiction='';jSelect.value=state.county;state.listPage=1;load(true);});
  }}).addTo(map);
  map.fitBounds([[32.926141,-83.42909],[33.1904,-83.044327]],{padding:[12,12]});

  function showStatus(text) { status.hidden = !text; status.firstChild.textContent = text || ""; }

  async function load(fit=false) {
    const token=++requestToken;
    showStatus("Loading map layers…");
    try {
      const [f, r] = await Promise.all([
        get("/api/map/features" + qs({ jurisdiction: state.jurisdiction, county:state.county,q:state.q.trim(), condition: state.condition })),
        get("/api/map/reports").catch(() => ({ features: [] })),
      ]);
      if(token!==requestToken)return;
      featureData = f; reportData = r;
      if(selectedId&&![...f.features,...r.features].some(f=>f.id===selectedId)){
        selectedId=null;clear(detail).append(h('h3','Details'),h('p.small.muted','Select a matching project or road to view its sources and costs.'));
      }
      draw();
      if(fit)fitResults();
      history.replaceState(null,'','/map'+qs({county:state.county,q:state.q.trim(),condition:state.condition,feature:selectedId}));
      showStatus(f.features.length || r.features.length ? "" : "No records match these filters. Try another county or search term.");
    } catch (err) {
      if(token!==requestToken)return;
      showStatus(err.status === 503 ? "Map database not connected in this environment — base map only." : "Could not load map layers.");
    }
  }

  function draw() {
    if(state.layers.has('boundary')) {if(!map.hasLayer(countyLayer))countyLayer.addTo(map);}else if(map.hasLayer(countyLayer))map.removeLayer(countyLayer);
    if (layer) map.removeLayer(layer);
    const feats = featureData.features.filter((f) => state.layers.has(f.properties.kind));
    visibleFeatures=feats;
    const reps = state.layers.has("report") && !state.condition && !state.q && !state.county ? reportData.features : [];
    const anchors=feats.filter(f=>f.geometry&&f.geometry.type!=='Point').map(f=>({...f,geometry:{type:'Point',coordinates:f.properties.marker_location?[f.properties.marker_location[1],f.properties.marker_location[0]]:[L.geoJSON(f).getBounds().getCenter().lng,L.geoJSON(f).getBounds().getCenter().lat]},properties:{...f.properties,is_anchor:true}}));
    layer = L.geoJSON({ type: "FeatureCollection", features: [...feats.filter(f=>f.geometry),...anchors, ...reps] }, {
      style: featureStyle,
      pointToLayer: (f, ll) => f.properties.kind === "report"
        ? L.circleMarker(ll, { radius: 8, color: "#fff", weight: 2, fillColor: "#245a9b", fillOpacity: 0.95 })
        : L.marker(ll,{title:f.properties.title,alt:f.properties.title,keyboard:true,icon:L.divIcon({className:'project-map-pin-wrap',html:icon(f.properties.kind==='road'?'map':'building',18).outerHTML,iconSize:[32,32],iconAnchor:[16,16]})}),
      onEachFeature: (f, lyr) => {
        const p = f.properties;
        const nearby=()=>{
          const ll=lyr.getLatLng?.();if(!ll)return [];
          const at=map.latLngToLayerPoint(ll);
          return visibleFeatures.filter(x=>{
            const point=x.properties.marker_location||(x.geometry?.type==='Point'?[x.geometry.coordinates[1],x.geometry.coordinates[0]]:null);
            return point&&at.distanceTo(map.latLngToLayerPoint(point))<32;
          });
        };
        lyr.bindPopup(()=>{
          const neighbors=nearby();
          return h('div',projectPreview(p),h('button.btn-link',{type:'button',onclick:()=>select(f)},'View details'),
            neighbors.length>1?h('div',h('h4','Projects at nearby locations'),neighbors.map(n=>h('p',h('button.btn-link',{type:'button',onclick:()=>select(n)},n.properties.title)))):null);
        });
        lyr.bindTooltip(projectPreview(p), { sticky: true,className:'project-map-tooltip',direction:'top',opacity:1 });
        lyr.on("click", () => {if(nearby().length<=1)select(f);});
        lyr.on("keypress", (e) => { if (e.originalEvent.key === "Enter") select(f); });
      },
    }).addTo(map);
    const located=feats.filter(f=>f.geometry).length;
    counts.textContent = `${plural(feats.length, "record")} · ${located} mapped · ${feats.length-located} in county directories`;
    drawDirectories(feats.filter(f=>!f.geometry));
    drawList();
  }

  function drawDirectories(unlocated) {
    if(directoryLayer)map.removeLayer(directoryLayer);
    directoryLayer=L.layerGroup().addTo(map);
    for(const county of countyGeo.features) {
      const records=unlocated.filter(f=>f.properties.county_ids?.includes(county.properties.GEOID));
      if(!records.length)continue;
      const at=L.geoJSON(county).getBounds().getCenter();
      const marker=L.marker(at,{title:county.properties.NAME+' County project directory',alt:county.properties.NAME+' County project directory',icon:L.divIcon({className:'project-county-directory',html:String(records.length),iconSize:[32,32],iconAnchor:[16,16]})});
      marker.bindTooltip(h('div.project-map-preview',h('strong',county.properties.NAME+' County directory'),h('span',plural(records.length,'record')+' without saved site locations'),h('small','County navigation marker, not a project location.')),{direction:'top',className:'project-map-tooltip'});
      marker.on('click',()=>{state.county=county.properties.GEOID;state.jurisdiction='';jSelect.value=state.county;state.listPage=1;load(true);});marker.addTo(directoryLayer);
    }
  }
  function fitResults() {
    const bounds=L.latLngBounds([]);
    visibleFeatures.filter(f=>f.geometry).forEach(f=>bounds.extend(L.geoJSON(f).getBounds()));
    const areaIds=new Set(visibleFeatures.filter(f=>!f.geometry).flatMap(f=>f.properties.county_ids||[]));
    for(const f of countyGeo.features)if(areaIds.has(f.properties.GEOID)||f.properties.GEOID===state.county)bounds.extend(L.geoJSON(f).getBounds());
    if(bounds.isValid())map.fitBounds(bounds,{padding:[28,28],maxZoom:14});
  }
  function drawList() {
    const pageSize=12;const start=(state.listPage-1)*pageSize;
    clear(listing).append(h('h2','Project & road directory'),h('p.small.muted',plural(visibleFeatures.length,'record')+' matching your filters. Records without a saved location remain searchable here.'),
      h('div.grid.grid-2',visibleFeatures.slice(start,start+pageSize).map(f=>h('article.card',h('h3',h('button.btn-link.project-result-title',{type:'button',onclick:()=>{
        select(f);if(f.geometry)map.fitBounds(L.geoJSON(f).getBounds(),{maxZoom:15,padding:[24,24]});else if(f.properties.county_id){const county=countyGeo.features.find(c=>c.properties.GEOID===f.properties.county_id);if(county)map.fitBounds(L.geoJSON(county).getBounds());}
        detail.scrollIntoView({behavior:'smooth',block:'nearest'});
      }},f.properties.title)),h('p.small.muted',f.properties.jurisdiction_name),h('p.small',projectCost(f.properties)),h('p.small','Contractor: '+(f.properties.contractor||'Not recorded')),!f.geometry?h('span.badge','Site location not recorded'):null))),
      visibleFeatures.length>pageSize?h('div.btn-row',{style:{marginTop:'16px'}},h('button.btn.btn-ghost',{type:'button',disabled:state.listPage===1||undefined,onclick:()=>{state.listPage--;drawList();}},'Previous'),h('span.small',`${state.listPage} / ${Math.ceil(visibleFeatures.length/pageSize)}`),h('button.btn.btn-ghost',{type:'button',disabled:start+pageSize>=visibleFeatures.length||undefined,onclick:()=>{state.listPage++;drawList();}},'Next')):null);
  }

  async function readSource(id,title) {
    const body=h('div',h('p.small.muted','Preserved automated source extraction. Check the original document; this text is not a certified transcription.'));
    modal(title||'Preserved source text',body);
    try {const source=await get('/data/map-source/transcripts/'+encodeURIComponent(id)+'.json');
      for(const p of source.pages||[])body.append(h('section',h('h3','PDF page '+(p.number||p.page||p.page_number)),h('pre.project-source-text',p.text||p.content||'')));
    }catch(e){body.append(notice(e.message,'warning'));}
  }

  async function select(f) {
    selectedId=f.id;
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
      if(selectedId!==f.id)return;
      const ft = d.feature;
      if(ft.properties?.legacy) {
        clear(detail).append(importedProjectDetails(ft,ft.properties.legacy,readSource));
        history.replaceState(null,'','/map'+qs({county:state.county,q:state.q.trim(),feature:f.id}));
        if(innerWidth<=1020)detail.scrollIntoView({behavior:'smooth',block:'start'});
        return;
      }
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
    if (f) { select(f); if(f.geometry){const g = L.geoJSON(f); map.fitBounds(g.getBounds(), { maxZoom: 16 });}else fitResults(); }
  }
  if (location.hash === "#report" && user()) reportBtn.click();
  return ()=>{requestToken++;clearTimeout(searchTimer);destroy();};
}

export { empty, can };
