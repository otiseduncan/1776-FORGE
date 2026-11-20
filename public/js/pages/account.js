import { h, icon } from "../core/dom.js";
import { get, post, patch } from "../core/api.js";
import { date, ago, label, plural } from "../core/format.js";
import { pageHero, setTitle, empty, notice, field, bindForm, toast, avatar, roleTag, modal } from "../core/ui.js";
import { session, user, signInUrl, loadSession } from "../core/session.js";

const SIGNIN_ERRORS = {
  cancelled: "Sign-in was cancelled. No account was created.",
  state: "Your sign-in link expired or was opened in a different browser. Please try again.",
  expired: "Your sign-in attempt took too long. Please try again.",
  verification: "Google could not verify your sign-in. Please try again.",
  unverified: "Your Google account email is not verified. Verify it with Google, then try again.",
  blocked: "This account cannot sign in. If you think this is a mistake, contact the Baldwin Minute Watch team.",
};

const GOOGLE_G = () => {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 48 48"); svg.setAttribute("width", "20"); svg.setAttribute("height", "20"); svg.setAttribute("aria-hidden", "true");
  for (const [fill, d] of [["#EA4335", "M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"], ["#4285F4", "M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z"], ["#FBBC05", "M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"], ["#34A853", "M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.1 1.4-4.9 2.3-8.2 2.3-6.2 0-11.5-4.2-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"]]) {
    const p = document.createElementNS(ns, "path"); p.setAttribute("fill", fill); p.setAttribute("d", d); svg.append(p);
  }
  return svg;
};

export async function signin({ view, query }) {
  setTitle("Sign in");
  const cfg = session().config || {};
  const err = query.get("error");
  const returnTo = query.get("return") || "/";
  if (user()) { window.forgeNavigate(returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/", { replace: true }); return; }
  view.append(h("div.container.section", h("div.auth-card.panel", { style: { padding: "40px 28px" } },
    h("img.brand-emblem", { src: "/assets/brand/bmw-eagle-flag.webp", alt: "", width: 88, height: 88 }),
    h("div.eyebrow", "Free membership"),
    h("h1", { style: { fontSize: "var(--fs-2xl)" } }, "Join Baldwin Minute Watch"),
    h("p.muted", "Reading is always free. A free account lets you take part."),
    err ? notice(SIGNIN_ERRORS[err] || "Sign-in did not complete. Please try again.", "danger", "alert") : null,
    h("ul.list-plain.perks",
      ["Start and reply to community discussions", "Follow threads and get notified of replies", "Report road conditions on the map", "Flag content for moderator review"].map((t) => h("li", icon("check", 18), t))),
    cfg.authConfigured
      ? h("a.google-btn", { href: signInUrl(returnTo), "data-native": "" }, GOOGLE_G(), "Continue with Google")
      : notice(h("span", h("strong", "Sign-in isn't configured in this environment yet. "), "An administrator must add the Google OAuth client before members can join. Everything public remains readable."), "warning", "lock"),
    h("p.small.muted", { style: { marginTop: "20px" } }, "We use Google only to confirm your identity and verified email. Baldwin Minute Watch never sees your Google password. ", h("a", { href: "/standards#privacy" }, "Privacy"), " · ", h("a", { href: "/standards#community" }, "Community guidelines")))));
}

export async function account({ view, query }) {
  setTitle("Your account");
  const u = user();
  if (!u) { view.append(pageHero({ eyebrow: "Account", title: "Your account" }), h("div.container.section", h("div.auth-card", empty({ iconName: "user", title: "Sign in to manage your account", actions: h("a.btn.btn-gold", { href: "/signin?return=/account" }, "Sign in") })))); return; }
  view.append(pageHero({ eyebrow: "Account", title: u.display_name, lede: query.get("welcome") ? "Welcome to Baldwin Minute Watch. Set the name other members will see." : null, meta: h("div.btn-row", roleTag(u.role) || h("span.role-tag", "Member"), h("a.btn.btn-ghost-light.btn-sm", { href: `/authors/${u.id}` }, "View public profile")) }));
  const profileForm = h("form.panel", h("h3", "Public profile"),
    h("div", { style: { display: "flex", gap: "14px", alignItems: "center", marginBottom: "16px" } }, avatar(u, 56), h("div.small.muted", "Your photo comes from your Google account.")),
    field({ name: "display_name", label: "Display name", value: u.display_name, required: true, max: 60, hint: "Shown on your posts. Use your real name or a consistent handle." }),
    field({ name: "bio", label: "About you", type: "textarea", rows: 4, value: u.bio || "", max: 600 }),
    h("button.btn.btn-blue", { type: "submit" }, "Save profile"));
  bindForm(profileForm, async (d) => { await patch("/api/me", d); await loadSession(true); toast("Profile saved.", "success"); });

  const caps = session().me?.capabilities || [];
  const access = h("section.panel", h("h3", "Membership & access"),
    h("dl.meta", h("dt", "Email"), h("dd", u.email), h("dt", "Role"), h("dd", label("role", u.role)), h("dt", "Member since"), h("dd", date(u.created_at)), h("dt", "Plan"), h("dd", "Free membership")),
    h("p.small.muted", "Roles grant responsibilities (contributor, researcher, editor) and are assigned by administrators. Membership is free; Baldwin Minute Watch does not take payments."),
    caps.length ? h("details", h("summary.small", `What your role can do (${caps.length})`), h("ul.small", caps.map((c) => h("li", c)))) : null);

  const security = h("section.panel", h("h3", icon("lock", 14), " Security"),
    h("p.small", "Signed in with Google. Signing out everywhere ends every session on every device."),
    h("div.btn-row",
      h("button.btn.btn-ghost", { type: "button", onclick: async () => { if (!confirm("Sign out of Baldwin Minute Watch on all devices?")) return; await post("/api/me/sessions/revoke-all"); await loadSession(true); window.forgeNavigate("/"); toast("Signed out everywhere.", "success"); } }, icon("logout", 16), "Sign out everywhere")));

  const danger = h("section.panel", { style: { borderColor: "var(--danger)" } }, h("h3", "Delete account"),
    h("p.small", "Your name, email, photo and bio are removed and your posts are attributed to “Former member”. Published contributions stay so discussions remain readable. This cannot be undone."),
    h("button.btn.btn-red", { type: "button", onclick: deleteDialog }, "Delete my account"));

  view.append(h("div.container.section", h("div.layout-sidebar", h("div.stack", profileForm, security, danger), h("aside", access,
    h("section.panel", h("h3", "Shortcuts"), h("ul.related-list", h("li", h("a", { href: "/notifications" }, icon("bell", 16), h("span", "Notifications"))), h("li", h("a", { href: "/community/new" }, icon("chat", 16), h("span", "Start a discussion"))), h("li", h("a", { href: "/map" }, icon("pin", 16), h("span", "Report a road condition")))))))));
}

function deleteDialog() {
  const form = h("form", h("p", "Type ", h("strong", "DELETE"), " to permanently delete your account."), field({ name: "confirm", label: "Confirmation", required: true }), h("button.btn.btn-red", { type: "submit" }, "Permanently delete"));
  const dlg = modal("Delete your account", form);
  bindForm(form, async (d) => { await post("/api/me/delete", { confirm: d.confirm }); dlg.close(); await loadSession(true); window.forgeNavigate("/"); toast("Your account was deleted.", "success"); });
}

export async function notifications({ view }) {
  setTitle("Notifications");
  if (!user()) { view.append(pageHero({ eyebrow: "Account", title: "Notifications" }), h("div.container.section", empty({ iconName: "bell", title: "Sign in to see notifications", actions: h("a.btn.btn-gold", { href: "/signin?return=/notifications" }, "Sign in") }))); return; }
  const data = await get("/api/notifications");
  const unread = data.items.filter((x) => !x.read_at);
  view.append(pageHero({ eyebrow: "Account", title: "Notifications", actions: unread.length ? h("button.btn.btn-ghost-light", { type: "button", onclick: async () => { await post("/api/notifications/read", {}); await loadSession(true); window.forgeNavigate("/notifications", { replace: true }); } }, icon("check", 16), "Mark all read") : null }));
  const box = h("div.container.container-narrow.section");
  if (!data.items.length) box.append(empty({ iconName: "bell", title: "You're all caught up", text: "Replies to discussions you follow, review decisions and moderation notices appear here." }));
  else box.append(h("ul.list-plain.stack", data.items.map((x) => h("li.card", { style: x.read_at ? {} : { borderLeft: "4px solid var(--gold-500)" } },
    h("div.kicker", label("notification", x.kind), h("span", "· " + ago(x.created_at)), x.read_at ? null : h("span.badge.badge-gold", "New")),
    h("p", { style: { margin: "4px 0 0" } }, x.link ? h("a", { href: x.link, onclick: () => { if (!x.read_at) post("/api/notifications/read", { ids: [x.id] }).then(() => loadSession(true)); } }, x.message) : x.message)))));
  view.append(box);
}

export async function profile({ view, params }) {
  let data;
  try { data = await get(`/api/authors/${encodeURIComponent(params.id)}`); }
  catch (err) { if (err.status === 404) { const { notFound } = await import("./static.js"); return notFound({ view }); } throw err; }
  const p = data.profile;
  setTitle(p.display_name);
  view.append(pageHero({ eyebrow: p.role !== "member" ? `Baldwin Minute Watch ${label("role", p.role).toLowerCase()}` : "Community member", title: p.display_name, lede: p.bio, meta: h("span.small", `Member since ${date(p.created_at)} · ${plural(data.commentCount, "reply", "replies")}`) }));
  const main = h("div.stack");
  if (data.articles.length) main.append(h("section", h("h2", { style: { fontSize: "var(--fs-xl)" } }, "Reporting"), h("div.grid.grid-2", data.articles.map((a) => h("article.card.interactive.card-accent-red",
    h("div.kicker", label("kind", a.kind), a.category_name && h("span", "· " + a.category_name)), h("h3", h("a", { href: `/news/${a.slug}` }, a.title)), a.summary && h("p", a.summary), h("div.card-foot", h("span", date(a.published_at))))))));
  main.append(h("section", h("h2", { style: { fontSize: "var(--fs-xl)" } }, "Discussions started"), data.discussions.length ? h("ul.related-list", data.discussions.map((d) => h("li", h("a", { href: `/community/t/${d.id}` }, icon("chat", 16), h("span", d.title, h("span.small.muted", ` · ${plural(d.comment_count, "reply", "replies")} · ${date(d.created_at)}`)))))) : h("p.muted", "No discussions yet.")));
  view.append(h("div.container.section", main));
}

