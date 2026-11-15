// Shared FORGE interface components.
import { h, icon, clear } from "./dom.js";
import { label, date, initials, ago } from "./format.js";
import { session, user, signInUrl } from "./session.js";

export function pageHero({ eyebrow, title, lede, crumbs, meta, actions }) {
  return h("section.page-hero",
    h("div.container",
      crumbs && h("nav.breadcrumbs", { "aria-label": "Breadcrumb" }, crumbs.flatMap((c, i) => [i ? " / " : null, c.href ? h("a", { href: c.href }, c.label) : h("span", c.label)])),
      eyebrow && h("div.eyebrow", eyebrow),
      h("h1", title),
      lede && h("p.lede", lede),
      (meta || actions) && h("div.hero-meta", meta, actions)));
}

export function sectionHead(title, sub, action) {
  return h("div.section-head", h("div", h("h2", title), h("span.section-title-rule"), sub && h("p", sub)), action);
}

export function badge(kind, text, iconName) {
  return h(`span.badge.badge-${kind}`, iconName && icon(iconName, 12), text);
}

export function verificationBadge(state) {
  const map = { verified: ["verified", "shield"], unreviewed: ["unreviewed", "alert"], disputed: ["disputed", "alert"], superseded: ["superseded", "layers"] };
  const [k, i] = map[state] || ["unreviewed", "alert"];
  return badge(k, label("verification", state || "unreviewed"), i);
}

export function resourceStatusBadge(state) {
  const k = { verified: "verified", unverified: "unverified", needs_review: "needs_review", broken: "broken" }[state] || "unverified";
  return badge(k, label("resource", state), state === "verified" ? "check" : "alert");
}

export function empty({ title, text, iconName = "doc", actions }) {
  return h("div.empty", h("div.empty-icon", icon(iconName, 28)), h("h3", title), text && h("p", text), actions && h("div.btn-row", actions));
}

export function notice(text, kind = "info", iconName = "info") {
  return h(`div.notice${kind !== "info" ? ".notice-" + kind : ""}`, icon(iconName, 20), h("div", text));
}

export function skeleton(count = 3, height = 140) {
  return h("div.grid.grid-3", Array.from({ length: count }, () => h("div.skeleton", { style: { minHeight: height + "px" } })));
}

export function errorBox(err, retry) {
  return h("div.notice.notice-danger", { role: "alert" }, icon("alert", 20), h("div",
    h("strong", err?.status === 503 ? "This part of FORGE is not connected yet. " : "Something went wrong. "),
    err?.message || "Please try again.",
    retry && h("div", { style: { marginTop: "8px" } }, h("button.btn.btn-sm.btn-ghost", { type: "button", onclick: retry }, "Try again"))));
}

export function avatar(u, size = 34) {
  if (u?.avatar_url) return h("img.avatar", { src: u.avatar_url, alt: "", width: size, height: size, referrerpolicy: "no-referrer", style: { width: size + "px", height: size + "px" } });
  return h("span.avatar", { "aria-hidden": "true", style: { width: size + "px", height: size + "px" } }, initials(u?.display_name || u?.author));
}

export function roleTag(role) {
  if (!role || role === "member") return null;
  return h("span.role-tag", label("role", role));
}

export function pagination(page, pageSize, total, onPage) {
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1) return null;
  const nav = h("nav.pagination", { "aria-label": "Pagination" });
  const btn = (p, text, disabled, current) => h("button", { type: "button", disabled: disabled || undefined, "aria-current": current ? "page" : undefined, "aria-label": typeof text === "string" ? undefined : `Page ${p}`, onclick: () => onPage(p) }, text);
  nav.append(btn(page - 1, "‹ Prev", page <= 1));
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  for (let p = start; p <= Math.min(pages, start + 4); p++) nav.append(btn(p, String(p), false, p === page));
  nav.append(btn(page + 1, "Next ›", page >= pages));
  return nav;
}

let toastHost;
export function toast(message, kind = "info") {
  if (!toastHost) { toastHost = h("div.toasts", { role: "status", "aria-live": "polite" }); document.body.append(toastHost); }
  const t = h(`div.toast.${kind}`, message);
  toastHost.append(t);
  setTimeout(() => t.remove(), 5200);
}

export function modal(title, content, { onClose } = {}) {
  const dlg = h("dialog.modal", { "aria-labelledby": "modal-title" },
    h("div.modal-head", h("h2#modal-title", title), h("button.modal-close", { type: "button", "aria-label": "Close", onclick: () => dlg.close() }, icon("close", 22))),
    h("div.modal-body", content));
  dlg.addEventListener("close", () => { dlg.remove(); onClose?.(); });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

/** Labelled form field. type: text|textarea|select|date|url|number|email */
export function field({ name, label: text, type = "text", value, required, hint, options, placeholder, rows, max, attrs = {} }) {
  const id = "f-" + name + "-" + Math.random().toString(36).slice(2, 7);
  let control;
  const common = { id, name, required: required || undefined, placeholder, "aria-describedby": hint ? id + "-hint" : undefined, ...attrs };
  if (type === "textarea") control = h("textarea.textarea", { ...common, rows: rows || 6, maxlength: max }, value || "");
  else if (type === "select") control = h("select.select", common, (options || []).map((o) => h("option", { value: o.value, selected: String(o.value) === String(value ?? "") || undefined }, o.label)));
  else control = h("input.input", { ...common, type, value: value ?? "", maxlength: max });
  return h("div.field", h("label", { for: id }, text, required ? h("span", { "aria-hidden": "true", style: { color: "var(--red-600)" } }, " *") : null), control, hint && h("div.hint", { id: id + "-hint" }, hint));
}

export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === "checkbox") out[el.name] = el.checked;
    else if (el.type === "number") out[el.name] = el.value === "" ? null : Number(el.value);
    else out[el.name] = el.value.trim() === "" ? null : el.value;
  }
  return out;
}

/** Wire a form to an async submit handler with busy state and inline error. */
export function bindForm(form, handler) {
  const errorEl = h("p.form-error", { role: "alert", hidden: true });
  form.append(errorEl);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submit = form.querySelector("[type=submit]");
    errorEl.hidden = true;
    if (submit) submit.disabled = true;
    try {
      await handler(formData(form), form);
    } catch (err) {
      errorEl.textContent = err?.message || "Something went wrong.";
      if (err?.details?.duplicates) errorEl.textContent += " — Possible duplicates: " + err.details.duplicates.map((d) => d.title).join("; ");
      errorEl.hidden = false;
      const fieldName = err?.details?.field;
      if (fieldName && form.elements[fieldName]) { form.elements[fieldName].setAttribute("aria-invalid", "true"); form.elements[fieldName].focus(); }
    } finally {
      if (submit) submit.disabled = false;
    }
  });
  return form;
}

/** Call to action shown to visitors who are not signed in. */
export function joinPrompt(text = "Free membership is required to post. Reading is always free.") {
  const cfg = session().config;
  return h("div.notice.notice-gold", icon("users", 20), h("div",
    h("strong", "Join the conversation. "), text, " ",
    cfg?.authConfigured
      ? h("a", { href: signInUrl() }, "Sign in with Google")
      : h("span.muted", "(Sign-in is being configured for this environment.)")));
}

export function citationList(citations) {
  if (!citations?.length) return h("p.muted.small", "No citations recorded yet.");
  return h("ol.source-list", citations.map((c) => h("li", h("div",
    c.url ? h("a", { href: c.url, target: "_blank", rel: "noopener noreferrer" }, c.label, " ", icon("external", 12)) : h("strong", c.label),
    c.document_id && h("div.small", "Archived record: ", h("a", { href: `/records/${c.document_id}` }, c.document_title || "View record")),
    c.pinpoint && h("div.small.muted", c.pinpoint),
    c.note && h("div.small.muted", c.note)))));
}

const TYPE_ICON = { document: "doc", article: "news", map_feature: "pin", legal: "scale", meeting: "calendar", budget: "coins", resource: "link", motion: "vote", financial_report: "coins" };
const TYPE_LABEL = { document: "Record", article: "Reporting", map_feature: "Map", legal: "Law", meeting: "Meeting", budget: "Budget", resource: "Resource", motion: "Motion", financial_report: "Financial report" };

export function relatedList(items) {
  if (!items?.length) return h("p.muted.small", "No connected content yet.");
  return h("ul.related-list", items.map((r) => h("li", h("a", { href: r.href || "#" }, icon(TYPE_ICON[r.type] || "link", 16), h("span", h("span.small.muted", TYPE_LABEL[r.type] || r.type, " · "), r.title), h("span.rel", r.relationship.replace(/_/g, " "))))));
}

export function personLine(name, role, when) {
  return h("span", h("strong", name || "Former member"), " ", roleTag(role), when ? h("span.muted", " · ", ago(when)) : null);
}

export function setTitle(title) {
  document.title = title ? `${title} · 1776 FORGE` : "1776 FORGE — Fellowship for Open Records and Government Examination";
}

export function signedIn() { return !!user(); }

export { clear, date };
