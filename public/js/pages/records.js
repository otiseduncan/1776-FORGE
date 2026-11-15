import { h, icon, clear } from "../core/dom.js";
import { get, post, patch, api, qs } from "../core/api.js";
import { date, label, bytes, n } from "../core/format.js";
import { pageHero, empty, pagination, setTitle, verificationBadge, citationList, relatedList, errorBox, field, bindForm, toast, modal, notice } from "../core/ui.js";
import { discussionPanel } from "../core/discussion.js";
import { can } from "../core/session.js";

const LEVELS = [["", "All levels"], ["federal", "Federal"], ["state", "State"], ["county", "County"], ["city", "Municipal"]];
const VERIFY = [["", "Any status"], ["verified", "Verified"], ["unreviewed", "Unreviewed"], ["disputed", "Disputed"], ["superseded", "Superseded"]];

export async function recordsIndex({ view, query }) {
  setTitle("Public Records Library");
  const params = Object.fromEntries(["q", "level", "jurisdiction", "category", "verification", "from", "to", "sort", "page"].map((k) => [k, query.get(k) || ""]));
  const page = Number(params.page || 1);
  view.append(pageHero({
    eyebrow: "Documents, not just claims",
    title: "Public records library",
    lede: "Federal, state, county and municipal records — each with its original source, record date, verification status and a cryptographic fingerprint of the stored file.",
    actions: can("document.create") ? h("a.btn.btn-gold", { href: "/records/new" }, icon("plus", 18), "Add a record") : null,
  }));
  const [facets, data] = await Promise.all([
    get("/api/records/facets").catch(() => null),
    get("/api/records" + qs({ ...params, page })).catch((e) => ({ error: e })),
  ]);
  const go = (patchParams) => window.forgeNavigate("/records" + qs({ ...params, page: 1, ...patchParams }));

  const qInput = h("input.input", { type: "search", name: "q", value: params.q, placeholder: "Title, summary, citation, agency or jurisdiction", "aria-label": "Search records" });
  const searchForm = h("form.search-panel", { role: "search", style: { marginBottom: "24px" }, onsubmit: (e) => { e.preventDefault(); go({ q: qInput.value.trim() }); } },
    h("div.search-bar", h("div.input-wrap", icon("search", 20), qInput), h("button.btn.btn-red", { type: "submit" }, "Search records")));

  const sel = (name, options, value) => h("select.select", { name, "aria-label": name, onchange: (e) => go({ [name]: e.target.value }) }, options.map(([v, l]) => h("option", { value: v, selected: v === value || undefined }, l)));
  const filters = h("aside.filter-panel", { "aria-label": "Filters" },
    h("h3", "Government level"), sel("level", LEVELS, params.level),
    h("h3", "Jurisdiction"), sel("jurisdiction", [["", "All jurisdictions"], ...(facets?.jurisdictions || []).map((j) => [j.id, `${j.name} (${j.n})`])], params.jurisdiction),
    h("h3", "Category"), sel("category", [["", "All categories"], ...(facets?.categories || []).map((c) => [c.id, `${c.name} (${c.n})`])], params.category),
    h("h3", "Verification"), sel("verification", VERIFY, params.verification),
    h("h3", "Record date"),
    h("div.grid", { style: { gap: "8px" } },
      h("input.input", { type: "date", "aria-label": "From date", value: params.from, onchange: (e) => go({ from: e.target.value }) }),
      h("input.input", { type: "date", "aria-label": "To date", value: params.to, onchange: (e) => go({ to: e.target.value }) })),
    h("h3", "Sort"), sel("sort", [["", "Record date (newest)"], ["added", "Recently added"], ["title", "Title A–Z"]], params.sort),
    Object.values({ ...params, page: "" }).some(Boolean) ? h("p", { style: { marginTop: "16px" } }, h("a", { href: "/records" }, "Clear all filters")) : null);

  const results = h("div", { "aria-live": "polite" });
  if (data.error) results.append(errorBox(data.error));
  else {
    results.append(h("div.results-meta", h("span", `${n(data.total)} ${data.total === 1 ? "record" : "records"}${params.q ? ` matching “${params.q}”` : ""}`)));
    if (!data.items.length) {
      results.append(empty({ iconName: "doc", title: data.total === 0 && !params.q ? "No records have been added to this archive yet" : "No records match your search", text: "The new archive starts empty by design. Legacy records will be imported only after independent backup, inventory and hash verification — nothing is fabricated." }));
    } else {
      results.append(h("div.grid", data.items.map((d) => h("article.card.interactive",
        h("div.kicker", d.category_name || d.document_type, d.jurisdiction_name && h("span", "· " + d.jurisdiction_name), d.agency_name && h("span", "· " + d.agency_name)),
        h("h3", h("a", { href: `/records/${d.id}` }, d.title)),
        d.summary && h("p", d.summary.length > 220 ? d.summary.slice(0, 220) + "…" : d.summary),
        h("div.card-foot",
          h("span", icon("calendar", 14), " ", d.record_date ? date(d.record_date) : "Date not recorded", d.has_file ? h("span", " · ", icon("doc", 14), " Original file") : h("span", " · Source link only")),
          verificationBadge(d.verification_state))))));
      results.append(pagination(page, data.pageSize, data.total, (p) => go({ page: p })));
    }
  }
  view.append(h("div.container.section", searchForm, h("div.layout-filters", filters, results)));
}

export async function recordDetail({ view, params }) {
  let data;
  try { data = await get(`/api/records/${encodeURIComponent(params.id)}`); }
  catch (err) { if (err.status === 404) { const { notFound } = await import("./static.js"); return notFound({ view }); } throw err; }
  const d = data.document;
  setTitle(d.title);
  view.append(pageHero({
    crumbs: [{ label: "Public records", href: "/records" }, d.jurisdiction_name && { label: d.jurisdiction_name, href: `/records?jurisdiction=${d.jurisdiction_id}` }].filter(Boolean),
    eyebrow: d.category_name || d.document_type,
    title: d.title,
    lede: d.summary,
    meta: h("div.btn-row", verificationBadge(d.verification_state), d.source_kind && h("span.badge.badge-navy", label("sourceKind", d.source_kind)), d.imported_legacy_id && h("span.badge.badge-gold", "Migrated from legacy archive")),
  }));

  const main = h("div.stack");
  if (data.duplicates?.length) main.append(notice(h("span", "The same file is also stored on: ", data.duplicates.map((x, i) => [i ? ", " : "", h("a", { href: `/records/${x.id}` }, x.title)])), "warning", "alert"));
  if (d.verification_state === "disputed") main.append(notice("An editor has marked this record as disputed. See the citations and discussion for details.", "danger", "alert"));
  if (d.has_file) {
    const fileUrl = `/api/records/${d.id}/file`;
    main.append(h("div.btn-row",
      h("a.btn.btn-blue", { href: fileUrl, target: "_blank", rel: "noopener" }, icon("eye", 18), "Open original"),
      h("a.btn.btn-ghost", { href: fileUrl + "?download=1", download: d.original_filename || "" }, icon("download", 18), `Download${d.file_size ? ` (${bytes(d.file_size)})` : ""}`)));
    if (d.mime_type === "application/pdf") main.append(h("iframe.pdf-frame", { src: fileUrl, title: `PDF preview: ${d.title}`, loading: "lazy" }));
    else if (d.mime_type?.startsWith("image/")) main.append(h("img", { src: fileUrl, alt: `Scanned record: ${d.title}`, style: { borderRadius: "10px", border: "1px solid var(--border)" } }));
  } else {
    main.append(empty({ iconName: "doc", title: "No original file is stored yet", text: d.source_url ? "This record links to its official source. A verified copy has not been archived in FORGE storage yet." : "A researcher has catalogued this record but has not attached the original file.", actions: d.source_url ? [h("a.btn.btn-blue", { href: d.source_url, target: "_blank", rel: "noopener noreferrer" }, icon("external", 18), "View at official source")] : null }));
  }
  if (data.meetings?.length) main.append(h("section.panel", h("h3", icon("calendar", 14), " Meetings that cite this record"), h("ul.related-list", data.meetings.map((m) => h("li", h("a", { href: `/government/meetings/${m.id}` }, icon("calendar", 16), h("span", m.title, h("span.small.muted", " · " + date(m.meeting_date)))))))));
  main.append(h("section.panel", h("h3", icon("link", 14), " Connected content"), relatedList(data.related)));

  const prov = h("dl.meta",
    h("dt", "Record date"), h("dd", d.record_date ? date(d.record_date) : "Not recorded"),
    d.published_date && [h("dt", "Published"), h("dd", date(d.published_date))],
    h("dt", "Jurisdiction"), h("dd", d.jurisdiction_name ? h("a", { href: `/jurisdictions/${d.jurisdiction_id}` }, d.jurisdiction_name) : "—"),
    d.agency_name && [h("dt", "Agency"), h("dd", d.agency_name)],
    d.citation && [h("dt", "Citation"), h("dd", d.citation)],
    h("dt", "Source"), h("dd", d.source_url ? h("a", { href: d.source_url, target: "_blank", rel: "noopener noreferrer" }, new URL(d.source_url).hostname, " ", icon("external", 12)) : "Not linked"),
    h("dt", "Added"), h("dd", date(d.created_at)),
    d.verified_at && [h("dt", "Reviewed"), h("dd", date(d.verified_at))],
    d.has_file && [h("dt", "File"), h("dd", `${d.original_filename || "original"} · ${d.mime_type}${d.file_size ? " · " + bytes(d.file_size) : ""}`)],
    d.original_sha256 && [h("dt", "SHA-256"), h("dd.hash", d.original_sha256)],
    d.integrity_state && [h("dt", "Integrity"), h("dd", d.integrity_state === "ok" ? h("span.badge.badge-verified", "Hash matches") : h("span.badge.badge-disputed", d.integrity_state), d.integrity_checked_at ? h("span.small.muted", " " + date(d.integrity_checked_at)) : null)]);
  const side = h("aside",
    h("section.panel", h("h3", icon("shield", 14), " Provenance"), prov),
    h("section.panel", h("h3", icon("doc", 14), " Citations"), citationList(data.citations)),
    discussionPanel({ contextType: "document", contextId: d.id, contextTitle: d.title, discussions: data.discussions }));
  if (data.permissions.edit) side.prepend(researcherTools(d, data.permissions));
  view.append(h("div.container.section", h("div.layout-sidebar", main, side)));
}

function researcherTools(d, perms) {
  const reload = () => window.forgeNavigate(location.pathname, { replace: true });
  const panel = h("section.panel", h("h3", icon("edit", 14), " Researcher tools"));
  const row = h("div.btn-row");
  if (!d.has_file && can("document.create")) {
    const input = h("input", { type: "file", accept: "application/pdf,image/png,image/jpeg,image/webp,image/gif,text/plain,text/csv", hidden: true });
    input.addEventListener("change", async () => {
      if (!input.files?.[0]) return;
      const fd = new FormData(); fd.append("file", input.files[0]);
      try { const r = await api(`/api/records/${d.id}/file`, { method: "POST", body: fd }); toast(`Original stored · SHA-256 ${r.sha256.slice(0, 12)}…`, "success"); reload(); }
      catch (e) { toast(e.message + (e.details?.duplicates ? " — " + e.details.duplicates.map((x) => x.title).join(", ") : ""), "error"); }
    });
    row.append(h("button.btn.btn-blue.btn-sm", { type: "button", onclick: () => input.click() }, icon("upload", 16), "Attach original file"), input);
  }
  if (perms.verify) {
    row.append(h("select.select", { "aria-label": "Verification status", style: { maxWidth: "180px", minHeight: "34px" }, onchange: async (e) => { try { await patch(`/api/records/${d.id}`, { verification_state: e.target.value }); toast("Verification updated", "success"); reload(); } catch (err) { toast(err.message, "error"); } } },
      ["unreviewed", "verified", "disputed", "superseded"].map((s) => h("option", { value: s, selected: s === d.verification_state || undefined }, label("verification", s)))));
    if (d.has_file) row.append(h("button.btn.btn-ghost.btn-sm", { type: "button", onclick: async () => { try { const r = await post(`/api/records/${d.id}/integrity`); toast(`Integrity: ${r.state}`, r.state === "ok" ? "success" : "error"); reload(); } catch (e) { toast(e.message, "error"); } } }, icon("shield", 16), "Verify hash"));
  }
  row.append(h("button.btn.btn-ghost.btn-sm", { type: "button", onclick: () => linkDialog("document", d.id) }, icon("link", 16), "Link content"));
  row.append(h("button.btn.btn-ghost.btn-sm", { type: "button", onclick: () => citeDialog("document", d.id) }, icon("doc", 16), "Add citation"));
  panel.append(row);
  return panel;
}

export function linkDialog(sourceType, sourceId) {
  const form = h("form",
    field({ name: "target_type", label: "Connect to", type: "select", options: [["document", "Record"], ["article", "Article"], ["map_feature", "Map feature"], ["legal", "Legal authority"], ["meeting", "Meeting"], ["budget", "Budget"], ["resource", "Resource"]].map(([value, l]) => ({ value, label: l })) }),
    field({ name: "target_id", label: "Identifier", required: true, hint: "Paste the ID from the item's page address, e.g. amendment-14 or a record ID." }),
    field({ name: "relationship", label: "Relationship", type: "select", options: ["related", "cites", "supports", "contradicts", "supersedes", "responds_to", "interprets", "commentary", "evidence", "about"].map((v) => ({ value: v, label: v.replace("_", " ") })) }),
    h("button.btn.btn-blue", { type: "submit" }, "Create link"));
  const dlg = modal("Link related content", form);
  bindForm(form, async (data) => { await post("/api/links", { source_type: sourceType, source_id: sourceId, ...data }); dlg.close(); toast("Linked.", "success"); window.forgeNavigate(location.pathname, { replace: true }); });
}

export function citeDialog(subjectType, subjectId) {
  const form = h("form",
    field({ name: "label", label: "Citation", required: true, hint: "e.g. “Baldwin County FY2024 Adopted Budget, p. 14”" }),
    field({ name: "url", label: "Source URL (https)", type: "url" }),
    field({ name: "document_id", label: "…or archived record ID" }),
    field({ name: "pinpoint", label: "Pinpoint (page, section, timestamp)" }),
    h("button.btn.btn-blue", { type: "submit" }, "Add citation"));
  const dlg = modal("Add a citation", form);
  bindForm(form, async (data) => { await post("/api/citations", { subject_type: subjectType, subject_id: subjectId, ...data }); dlg.close(); toast("Citation added.", "success"); window.forgeNavigate(location.pathname, { replace: true }); });
}

export async function recordNew({ view }) {
  setTitle("Add a record");
  view.append(pageHero({ crumbs: [{ label: "Public records", href: "/records" }], eyebrow: "Researcher workspace", title: "Add a public record", lede: "Catalogue a record with its official source. You can attach the original file after saving; FORGE fingerprints it with SHA-256 and checks for duplicates." }));
  const box = h("div.container.container-narrow.section");
  view.append(box);
  if (!can("document.create")) { box.append(notice("Adding records requires a researcher role. Ask an administrator if you would like to help catalogue records.", "warning", "lock")); return; }
  const [facets, agencies] = await Promise.all([get("/api/records/facets"), get("/api/agencies")]);
  const form = h("form.panel",
    h("div.form-grid",
      h("div.full", field({ name: "title", label: "Title", required: true, max: 300, hint: "Use the title on the document itself." })),
      field({ name: "category_id", label: "Category", type: "select", options: [{ value: "", label: "Choose…" }, ...facets.categories.map((c) => ({ value: c.id, label: c.name }))] }),
      field({ name: "jurisdiction_id", label: "Jurisdiction", type: "select", options: [{ value: "", label: "Choose…" }, ...facets.jurisdictions.map((j) => ({ value: j.id, label: `${j.name} (${label("level", j.level)})` }))] }),
      field({ name: "agency_id", label: "Agency / department", type: "select", options: [{ value: "", label: "None / not listed" }, ...agencies.items.map((a) => ({ value: a.id, label: a.name }))] }),
      field({ name: "source_kind", label: "Source type", type: "select", options: ["official", "open_records_response", "court", "third_party", "community"].map((v) => ({ value: v, label: label("sourceKind", v) })) }),
      field({ name: "record_date", label: "Record date", type: "date", hint: "Date of the document itself." }),
      field({ name: "published_date", label: "Publication date", type: "date", hint: "When the agency released it, if known." }),
      h("div.full", field({ name: "source_url", label: "Official source URL", type: "url", hint: "https:// address where the agency publishes this record." })),
      h("div.full", field({ name: "citation", label: "Formal citation", max: 300 })),
      h("div.full", field({ name: "summary", label: "Neutral summary", type: "textarea", rows: 4, max: 4000, hint: "Describe what the document is — not what you think it proves." }))),
    h("button.btn.btn-gold", { type: "submit" }, "Save record"));
  bindForm(form, async (data) => {
    const res = await post("/api/records", data);
    toast("Record saved. Attach the original file next.", "success");
    window.forgeNavigate(`/records/${res.id}`);
  });
  box.append(form);
}

export { clear };
