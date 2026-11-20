import { h, icon, clear } from "../core/dom.js";
import { get, post, patch, qs } from "../core/api.js";
import { date, ago, label, n } from "../core/format.js";
import { pageHero, setTitle, empty, notice, field, bindForm, toast, modal, pagination } from "../core/ui.js";
import { user, can } from "../core/session.js";

const SECTIONS = [
  ["", "Overview", "layers", () => can("moderate") || can("users.manage")],
  ["moderation", "Moderation queue", "shield", () => can("moderate")],
  ["users", "Members & roles", "users", () => can("users.manage")],
  ["audit", "Audit log", "eye", () => can("audit.read")],
  ["imports", "Legacy imports", "upload", () => can("imports.manage")],
];

export async function admin({ view, params, query }) {
  const section = params.section || "";
  const def = SECTIONS.find((s) => s[0] === section);
  if (!def) { const { notFound } = await import("./static.js"); return notFound({ view }); }
  setTitle(def[1] + " · Administration");
  if (!def[3]()) {
    view.append(pageHero({ eyebrow: "Administration", title: def[1] }), h("div.container.section", empty({ iconName: "lock", title: user() ? "Administration requires an editor or administrator role" : "Sign in required", actions: user() ? null : h("a.btn.btn-gold", { href: "/signin?return=/admin" }, "Sign in") })));
    return;
  }
  const content = h("div.stack");
  view.append(pageHero({ eyebrow: "Administration", title: def[1] }));
  view.append(h("div.container.section", h("div.ws-layout",
    h("nav.ws-nav", { "aria-label": "Administration" }, SECTIONS.filter((s) => s[3]()).map(([id, l, ic]) => h("a", { href: `/admin${id ? "/" + id : ""}`, "aria-current": id === section ? "page" : undefined }, icon(ic, 18), l)),
      can("resource.write") ? h("a", { href: "/resources" }, icon("link", 18), "Resource links") : null,
      can("article.draft") ? h("a", { href: "/workspace" }, icon("edit", 18), "Workspace") : null),
    content)));
  if (section === "") await overview(content);
  else if (section === "moderation") await moderation(content);
  else if (section === "users") await users(content, query);
  else if (section === "audit") await auditLog(content, query);
  else if (section === "imports") await imports(content);
}

async function overview(content) {
  const { counts: c } = await get("/api/admin/overview");
  const groups = [
    ["Community", [["Open reports", c.open_reports, "/admin/moderation"], ["Posts awaiting review", c.pending_posts, "/admin/moderation"], ["Map reports awaiting review", c.pending_map_reports, "/admin/moderation"], ["Active members", c.members, can("users.manage") ? "/admin/users" : null]]],
    ["Newsroom", [["Articles in review", c.articles_in_review, "/workspace/articles?status=review"], ["Drafts", c.articles_draft, "/workspace/articles?status=draft"], ["Published", c.articles_published, "/news"]]],
    ["Archive", [["Records", c.documents, "/records"], ["Unreviewed", c.documents_unreviewed, "/records?verification=unreviewed"], ["Without original file", c.documents_without_file, "/records"], ["Integrity failures", c.integrity_failures, "/records"], ["Legacy import batches", c.import_batches, can("imports.manage") ? "/admin/imports" : null]]],
    ["Resources & map", [["Links needing attention", c.resources_need_attention, "/resources"], ["Links not yet checked", c.resources_unverified, "/resources"], ["Map features", c.map_features, "/map"]]],
  ];
  for (const [title, tiles] of groups) {
    content.append(h("section", h("h2", { style: { fontSize: "var(--fs-lg)" } }, title), h("div.grid.grid-4", tiles.map(([l, v, href]) => h(href ? "a.card.interactive" : "div.card", { href, style: { textDecoration: "none" } },
      h("strong", { style: { font: "700 1.9rem/1 var(--font-display)", color: Number(v) && /fail|attention|reports|review/i.test(l) ? "var(--red-600)" : "var(--heading)" } }, n(v)), h("div.small.muted", l))))));
  }
  if (c.integrity_failures) content.prepend(notice(`${n(c.integrity_failures)} record file(s) failed an integrity check. Investigate before relying on them.`, "danger", "alert"));
}

async function moderation(content) {
  const q = await get("/api/moderation/queue");
  const act = async (type, id, action, needsReason) => {
    let reason = null;
    if (needsReason) { reason = prompt("Public reason (shown in the moderation log):"); if (!reason) return; }
    await post("/api/moderation/actions", { target_type: type, target_id: id, action, reason });
    toast("Done.", "success");
    window.forgeNavigate(location.pathname, { replace: true });
  };
  const section = (title, items, render) => h("section.panel", h("h3", title, h("span.small.muted", ` (${items.length})`)), items.length ? h("div.stack", items.map(render)) : h("p.small.muted", "Nothing waiting."));

  content.append(section("Reported content", q.reports, (r) => h("div.card",
    h("div.kicker", label("target", r.target_type), h("span", `· ${r.reports} report${r.reports > 1 ? "s" : ""} · first ${ago(r.first_reported)}`)),
    h("p", { style: { margin: "4px 0" } }, r.target ? h("a", { href: r.target.link }, r.target.title || "(untitled)") : "(content no longer exists)"),
    h("div.small.muted", "Reasons: ", (r.reasons || "").split(",").map((x) => label("reason", x)).join(", ")),
    ["discussion", "comment", "attachment"].includes(r.target_type) ? h("div.btn-row", { style: { marginTop: "8px" } },
      h("button.btn.btn-red.btn-sm", { type: "button", onclick: () => act(r.target_type, r.target_id, "hide", true) }, "Remove"),
      h("button.btn.btn-ghost.btn-sm", { type: "button", onclick: () => act(r.target_type, r.target_id, "dismiss_reports") }, "Dismiss reports")) : null)));

  content.append(section("Discussions held for review", q.pendingDiscussions, (d) => h("div.card", h("div.kicker", d.author, h("span", "· " + ago(d.created_at))), h("h4", { style: { margin: "4px 0" } }, h("a", { href: `/community/t/${d.id}` }, d.title)), h("p.small", { style: { whiteSpace: "pre-wrap" } }, d.body.slice(0, 600)),
    h("div.btn-row", h("button.btn.btn-blue.btn-sm", { type: "button", onclick: () => act("discussion", d.id, "approve") }, "Approve"), h("button.btn.btn-red.btn-sm", { type: "button", onclick: () => act("discussion", d.id, "hide", true) }, "Remove")))));

  content.append(section("Replies held for review", q.pendingComments, (c) => h("div.card", h("div.kicker", c.author, h("span", "· " + ago(c.created_at))), h("p.small", { style: { whiteSpace: "pre-wrap" } }, c.body.slice(0, 600)),
    h("div.btn-row", h("a.btn.btn-ghost.btn-sm", { href: `/community/t/${c.discussion_id}#c-${c.id}` }, "In context"), h("button.btn.btn-blue.btn-sm", { type: "button", onclick: () => act("comment", c.id, "approve") }, "Approve"), h("button.btn.btn-red.btn-sm", { type: "button", onclick: () => act("comment", c.id, "hide", true) }, "Remove")))));

  content.append(section("Map reports awaiting review", q.pendingMapReports, (r) => h("div.card", h("div.kicker", label("category", r.category), h("span", `· ${r.author || "member"} · ${ago(r.created_at)}`)), h("h4", { style: { margin: "4px 0" } }, h("a", { href: `/map?report=${r.id}` }, r.title)), r.description && h("p.small", r.description),
    h("div.small.muted", `Location ${Number(r.lat).toFixed(5)}, ${Number(r.lng).toFixed(5)}`),
    h("div.btn-row", { style: { marginTop: "8px" } },
      h("button.btn.btn-blue.btn-sm", { type: "button", onclick: async () => { await post(`/api/map/reports/${r.id}/review`, { decision: "approved" }); toast("Report approved and published.", "success"); window.forgeNavigate(location.pathname, { replace: true }); } }, "Approve"),
      h("button.btn.btn-red.btn-sm", { type: "button", onclick: async () => { const note = prompt("Reason for rejecting (sent to the member):"); if (!note) return; await post(`/api/map/reports/${r.id}/review`, { decision: "rejected", note }); toast("Report rejected.", "success"); window.forgeNavigate(location.pathname, { replace: true }); } }, "Reject")))));

  content.append(section("Photos & files awaiting review", q.pendingAttachments, (a) => h("div.card", { style: { display: "flex", gap: "14px", alignItems: "center", flexWrap: "wrap" } },
    a.mime_type.startsWith("image/") ? h("img", { src: `/api/attachments/${a.id}`, alt: `Pending upload ${a.filename}`, style: { width: "120px", height: "90px", objectFit: "cover", borderRadius: "6px" } }) : h("a", { href: `/api/attachments/${a.id}`, target: "_blank", rel: "noopener" }, icon("doc", 20), a.filename),
    h("div", h("div.small", a.filename), h("div.small.muted", `${label("target", a.owner_type)} · ${ago(a.created_at)}`)),
    h("div.btn-row", { style: { marginLeft: "auto" } }, h("button.btn.btn-blue.btn-sm", { type: "button", onclick: () => act("attachment", a.id, "approve") }, "Approve"), h("button.btn.btn-red.btn-sm", { type: "button", onclick: () => act("attachment", a.id, "hide", true) }, "Reject")))));
  content.append(h("p.small", h("a", { href: "/community/moderation-log" }, "Public moderation log ", icon("arrow", 14))));
}

async function users(content, query) {
  const page = Number(query.get("page") || 1);
  const q = query.get("q") || "";
  const role = query.get("role") || "";
  const data = await get("/api/admin/users" + qs({ page, q, role }));
  const input = h("input.input", { type: "search", value: q, placeholder: "Name or email", "aria-label": "Search members" });
  const roleSel = h("select.select", { "aria-label": "Role", style: { maxWidth: "200px" } }, [h("option", { value: "" }, "All roles"), ...data.roles.map((r) => h("option", { value: r, selected: r === role || undefined }, label("role", r)))]);
  content.append(h("form.search-panel", { onsubmit: (e) => { e.preventDefault(); window.forgeNavigate("/admin/users" + qs({ q: input.value.trim(), role: roleSel.value })); } },
    h("div.search-bar", h("div.input-wrap", icon("search", 20), input), roleSel, h("button.btn.btn-blue", { type: "submit" }, "Filter"))));
  content.append(notice("Role changes and suspensions require a reason and are recorded in the audit log. You can assign roles below your own; only owners can create administrators or owners.", "info", "info"));
  if (!data.items.length) { content.append(empty({ iconName: "users", title: "No members match" })); return; }
  content.append(h("div.table-wrap", h("table.data", h("thead", h("tr", h("th", "Member"), h("th", "Role"), h("th", "State"), h("th", "Joined"), h("th", "Last sign-in"), h("th", ""))),
    h("tbody", data.items.map((u) => h("tr",
      h("td", h("a", { href: `/authors/${u.id}` }, u.display_name), h("div.small.muted", u.email)),
      h("td", label("role", u.role)), h("td", u.state === "active" ? "Active" : h("span.badge.badge-red", u.state)), h("td", date(u.created_at)), h("td", u.last_login_at ? ago(u.last_login_at) : "—"),
      h("td", u.id !== user().id ? h("button.btn.btn-ghost.btn-sm", { type: "button", onclick: () => accessDialog(u, data.roles) }, "Change access") : h("span.small.muted", "You"))))))));
  content.append(pagination(page, data.pageSize, data.items.length === data.pageSize ? page * data.pageSize + 1 : (page - 1) * data.pageSize + data.items.length, (p) => window.forgeNavigate("/admin/users" + qs({ q, role, page: p }))));
}

function accessDialog(u, roles) {
  const form = h("form",
    field({ name: "role", label: "Role", type: "select", value: u.role, options: roles.map((r) => ({ value: r, label: label("role", r) })) }),
    field({ name: "state", label: "Account state", type: "select", value: u.state, options: ["active", "suspended", "banned"].map((v) => ({ value: v, label: v })) }),
    field({ name: "reason", label: "Reason (recorded in audit log)", type: "textarea", rows: 3, required: true }),
    h("button.btn.btn-gold", { type: "submit" }, "Save"));
  const dlg = modal(`Access for ${u.display_name}`, form);
  bindForm(form, async (d) => { await patch(`/api/admin/users/${u.id}`, d); dlg.close(); toast("Access updated.", "success"); window.forgeNavigate(location.pathname + location.search, { replace: true }); });
}

async function auditLog(content, query) {
  const page = Number(query.get("page") || 1);
  const subject = query.get("subject_type") || "";
  const data = await get("/api/admin/audit" + qs({ page, subject_type: subject }));
  const sel = h("select.select", { "aria-label": "Subject type", style: { maxWidth: "240px" }, onchange: (e) => window.forgeNavigate("/admin/audit" + qs({ subject_type: e.target.value })) },
    ["", "user", "document", "article", "map_feature", "map_report", "legal", "resource", "meeting", "motion", "budget", "discussion", "comment", "legacy_import"].map((v) => h("option", { value: v, selected: v === subject || undefined }, v ? label("target", v) : "All subjects")));
  content.append(h("div", sel));
  if (!data.items.length) { content.append(empty({ iconName: "eye", title: "No audit events" })); return; }
  content.append(h("div.table-wrap", h("table.data", h("thead", h("tr", h("th", "When"), h("th", "Who"), h("th", "Action"), h("th", "Subject"), h("th", "Details"))),
    h("tbody", data.items.map((e) => h("tr", h("td.small", date(e.created_at)), h("td", e.actor || "system", e.actor_role ? h("div.small.muted", label("role", e.actor_role)) : null), h("td", h("code", e.action)), h("td.small", `${e.subject_type} ${String(e.subject_id || "").slice(0, 10)}`),
      h("td", e.details_json ? h("details", h("summary.small", "View"), h("pre.small", { style: { whiteSpace: "pre-wrap", maxWidth: "380px" } }, pretty(e.details_json))) : "—")))))));
  content.append(pagination(page, data.pageSize, data.items.length === data.pageSize ? page * data.pageSize + 1 : (page - 1) * data.pageSize + data.items.length, (p) => window.forgeNavigate("/admin/audit" + qs({ subject_type: subject, page: p }))));
}

function pretty(s) { try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; } }

async function imports(content) {
  const data = await get("/api/admin/imports");
  content.append(notice(h("span", h("strong", "Legacy data is imported only from verified manifests. "), "Run the read-only inventory script against an export of the legacy archive, review the reconciliation report, then register the batch here with the manifest's SHA-256. Nothing in this screen connects to or modifies the legacy application."), "warning", "shield"));
  content.append(h("section.panel", h("h3", "How a legacy import works"), h("ol", { style: { margin: 0, paddingLeft: "20px", display: "grid", gap: "6px" } },
    h("li", "Export the legacy D1 database and R2 objects read-only (see docs/MIGRATION.md)."),
    h("li", h("code", "node scripts/legacy/inventory.mjs <export-dir>"), " writes a manifest of rows, objects and SHA-256 hashes."),
    h("li", h("code", "node scripts/legacy/reconcile.mjs <manifest> <export-dir>"), " checks counts, references and hashes, and produces a report."),
    h("li", "Register the batch below. Import into the isolated The Forge database and bucket only after the report shows zero discrepancies."))));
  const form = h("form.panel", h("h3", "Register a verified import batch"),
    field({ name: "source_description", label: "Source description", required: true, hint: "Where the export came from and when it was taken" }),
    field({ name: "manifest_sha256", label: "Manifest SHA-256", required: true, attrs: { pattern: "[a-f0-9]{64}" } }),
    h("div.grid.grid-2", field({ name: "expected_rows", label: "Expected rows", type: "number" }), field({ name: "expected_objects", label: "Expected files", type: "number" })),
    field({ name: "report_json", label: "Reconciliation report (JSON)", type: "textarea", rows: 4 }),
    h("button.btn.btn-gold", { type: "submit" }, "Register batch"));
  bindForm(form, async (d) => { await post("/api/admin/imports", d); toast("Batch registered.", "success"); window.forgeNavigate(location.pathname, { replace: true }); });
  content.append(form);
  content.append(h("section.panel", h("h3", "Import ledger"), data.items.length ? h("div.table-wrap", h("table.data", h("thead", h("tr", h("th", "Registered"), h("th", "Source"), h("th", "State"), h("th.num", "Rows"), h("th.num", "Files"), h("th", "Manifest"))),
    h("tbody", data.items.map((b) => h("tr", h("td", date(b.created_at)), h("td", b.source_description), h("td", label("importState", b.state)), h("td.num", n(b.expected_rows)), h("td.num", n(b.expected_objects)), h("td", h("code.small", b.manifest_sha256.slice(0, 16) + "…")))))))
    : h("p.small.muted", "No legacy data has been imported. The legacy archive has not been migrated.")));
}

export { clear };
