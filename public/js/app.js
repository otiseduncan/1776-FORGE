// 1776 FORGE single-page application shell: routing, header, account menu, theme.
import { h, icon, clear, $, $$ } from "./core/dom.js";
import { loadSession, onSession, user, can, signInUrl, signOut, session } from "./core/session.js";
import { avatar, errorBox, setTitle } from "./core/ui.js";

const routes = [
  ["/", () => import("./pages/home.js").then((m) => m.home)],
  ["/news", () => import("./pages/news.js").then((m) => m.newsIndex)],
  ["/news/series", () => import("./pages/news.js").then((m) => m.seriesIndex)],
  ["/news/series/:slug", () => import("./pages/news.js").then((m) => m.seriesPage)],
  ["/news/:slug", () => import("./pages/news.js").then((m) => m.article)],
  ["/authors/:id", () => import("./pages/account.js").then((m) => m.profile)],
  ["/records", () => import("./pages/records.js").then((m) => m.recordsIndex)],
  ["/records/new", () => import("./pages/records.js").then((m) => m.recordNew)],
  ["/records/:id", () => import("./pages/records.js").then((m) => m.recordDetail)],
  ["/map", () => import("./pages/map.js").then((m) => m.mapPage)],
  ["/government", () => import("./pages/government.js").then((m) => m.govIndex)],
  ["/government/meetings/:id", () => import("./pages/government.js").then((m) => m.meetingDetail)],
  ["/government/bodies/:id", () => import("./pages/government.js").then((m) => m.bodyDetail)],
  ["/government/officials/:id", () => import("./pages/government.js").then((m) => m.officialDetail)],
  ["/government/budgets/:id", () => import("./pages/government.js").then((m) => m.budgetDetail)],
  ["/law", () => import("./pages/law.js").then((m) => m.lawIndex)],
  ["/law/:id", () => import("./pages/law.js").then((m) => m.lawDetail)],
  ["/resources", () => import("./pages/resources.js").then((m) => m.resourcesPage)],
  ["/community", () => import("./pages/community.js").then((m) => m.communityIndex)],
  ["/community/new", () => import("./pages/community.js").then((m) => m.newDiscussion)],
  ["/community/moderation-log", () => import("./pages/community.js").then((m) => m.moderationLog)],
  ["/community/c/:category", () => import("./pages/community.js").then((m) => m.communityIndex)],
  ["/community/t/:id", () => import("./pages/community.js").then((m) => m.thread)],
  ["/jurisdictions", () => import("./pages/jurisdictions.js").then((m) => m.jurisdictionsIndex)],
  ["/jurisdictions/:id", () => import("./pages/jurisdictions.js").then((m) => m.jurisdictionDetail)],
  ["/search", () => import("./pages/search.js").then((m) => m.searchPage)],
  ["/signin", () => import("./pages/account.js").then((m) => m.signin)],
  ["/account", () => import("./pages/account.js").then((m) => m.account)],
  ["/notifications", () => import("./pages/account.js").then((m) => m.notifications)],
  ["/standards", () => import("./pages/static.js").then((m) => m.standards)],
  ["/workspace", () => import("./pages/workspace.js").then((m) => m.workspace)],
  ["/workspace/:section", () => import("./pages/workspace.js").then((m) => m.workspace)],
  ["/workspace/articles/:id", () => import("./pages/workspace.js").then((m) => m.articleEditor)],
  ["/admin", () => import("./pages/admin.js").then((m) => m.admin)],
  ["/admin/:section", () => import("./pages/admin.js").then((m) => m.admin)],
].map(([path, load]) => {
  const keys = [];
  const re = new RegExp("^" + path.replace(/:([a-z]+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "/?$");
  return { re, keys, load };
});

const main = $("#main");
let cleanup = null;
let navToken = 0;

function match(pathname) {
  for (const r of routes) {
    const m = r.re.exec(pathname);
    if (m) return { load: r.load, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

function progress(on) {
  const bar = $("#loadingLine");
  if (on) { bar.style.opacity = "1"; bar.style.width = "60%"; }
  else { bar.style.width = "100%"; setTimeout(() => { bar.style.opacity = "0"; bar.style.width = "0"; }, 250); }
}

export async function render() {
  const token = ++navToken;
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  const url = new URL(location.href);
  const m = match(url.pathname);
  highlightNav(url.pathname);
  closeMenu();
  progress(true);
  try {
    const page = m ? await m.load() : (await import("./pages/static.js")).notFound;
    if (token !== navToken) return;
    // Mount the view before the page runs: some pages (the map) measure their containers while loading.
    const view = h("div.view", { "aria-busy": "true" });
    clear(main).append(view);
    const result = await page({ params: m?.params || {}, query: url.searchParams, view, rerender: render });
    if (token !== navToken) { if (typeof result === "function") result(); return; }
    view.removeAttribute("aria-busy");
    cleanup = typeof result === "function" ? result : null;
  } catch (err) {
    console.error(err);
    if (token !== navToken) return;
    setTitle("Error");
    clear(main).append(h("div.container.section", errorBox(err, render)));
  } finally {
    progress(false);
  }
  if (!url.hash) window.scrollTo({ top: 0, behavior: "instant" });
  else document.getElementById(url.hash.slice(1))?.scrollIntoView();
  main.focus({ preventScroll: true });
}

export function navigate(href, { replace = false } = {}) {
  if (replace) history.replaceState(null, "", href); else history.pushState(null, "", href);
  render();
}
window.forgeNavigate = navigate;

function highlightNav(pathname) {
  for (const a of $$("#primaryNav a")) {
    const href = a.getAttribute("href");
    const active = pathname === href || pathname.startsWith(href + "/");
    if (active) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
}

// Intercept same-origin navigation.
document.addEventListener("click", (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest("a[href]");
  if (!a || a.target || a.hasAttribute("download") || a.dataset.native !== undefined) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/assets/") || url.pathname.startsWith("/vendor/")) return;
  if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
  e.preventDefault();
  navigate(url.pathname + url.search + url.hash);
});
window.addEventListener("popstate", render);
document.addEventListener("click", () => { for (const d of $$(".dropdown.open")) d.classList.remove("open"); });

// ---------------------------------------------------------------- header
const menuToggle = $("#menuToggle");
const nav = $("#primaryNav");
menuToggle.append(icon("menu", 22));
$("#searchBtn").append(icon("search", 20));
function closeMenu() {
  nav.classList.remove("open");
  menuToggle.setAttribute("aria-expanded", "false");
  clear(menuToggle).append(icon("menu", 22));
}
menuToggle.addEventListener("click", () => {
  const open = !nav.classList.contains("open");
  nav.classList.toggle("open", open);
  menuToggle.setAttribute("aria-expanded", String(open));
  menuToggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  clear(menuToggle).append(icon(open ? "close" : "menu", 22));
  if (open) nav.querySelector("a")?.focus();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeMenu(); $(".dropdown.open")?.classList.remove("open"); } });

function renderAccount() {
  const slot = clear($("#accountSlot"));
  const u = user();
  if (!u) {
    const cfg = session().config;
    slot.append(h("a.btn.btn-gold.btn-sm", { href: cfg?.authConfigured ? signInUrl() : "/signin", "data-native": cfg?.authConfigured ? "" : undefined }, "Join free"));
    return;
  }
  const unread = session().me?.unreadNotifications || 0;
  const menu = h("div.dropdown", { role: "menu" },
    h("div.who", h("strong", u.display_name), h("span.small.muted", u.role === "member" ? "Free member" : u.role[0].toUpperCase() + u.role.slice(1))),
    h("a", { href: "/account", role: "menuitem" }, icon("user", 18), "Account & profile"),
    h("a", { href: "/notifications", role: "menuitem" }, icon("bell", 18), "Notifications", unread ? h("span.badge.badge-red", String(unread)) : null),
    (can("article.draft") || can("document.create")) && h("a", { href: "/workspace", role: "menuitem" }, icon("edit", 18), "Contributor workspace"),
    (can("moderate") || can("users.manage")) && h("a", { href: "/admin", role: "menuitem" }, icon("shield", 18), "Administration"),
    h("button.item", { type: "button", role: "menuitem", onclick: async () => { await signOut(); navigate("/"); } }, icon("logout", 18), "Sign out"));
  const btn = h("button", { type: "button", "aria-haspopup": "menu", "aria-expanded": "false", "aria-label": `Account menu for ${u.display_name}` }, avatar(u, 38));
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = !menu.classList.contains("open");
    menu.classList.toggle("open", open);
    btn.setAttribute("aria-expanded", String(open));
  });
  menu.addEventListener("click", () => menu.classList.remove("open"));
  slot.append(h("div.account-menu",
    can("article.draft") ? h("a.btn.btn-gold.btn-sm.desk-link", { href: "/workspace/articles", "aria-label": "Newsroom desk: manage your articles" }, icon("edit", 16), h("span.desk-label", "Newsroom desk")) : null,
    unread ? h("a.icon-btn", { href: "/notifications", "aria-label": `${unread} unread notifications`, style: { marginRight: "8px" } }, icon("bell", 18), h("span.count", String(unread))) : null,
    btn, menu));
  slot.style.display = "flex";
}

// ---------------------------------------------------------------- theme
function applyTheme(choice) {
  if (choice === "light" || choice === "dark") document.documentElement.dataset.theme = choice;
  else delete document.documentElement.dataset.theme;
  try { if (choice === "auto") localStorage.removeItem("forge-theme"); else localStorage.setItem("forge-theme", choice); } catch { /* storage unavailable */ }
  for (const b of $$("[data-theme-choice]")) b.setAttribute("aria-pressed", String(b.dataset.themeChoice === (choice || "auto")));
}
for (const b of $$("[data-theme-choice]")) b.addEventListener("click", () => applyTheme(b.dataset.themeChoice));
applyTheme(document.documentElement.dataset.theme || "auto");
$("#year").textContent = String(new Date().getFullYear());

onSession(renderAccount);
loadSession().finally(render);
