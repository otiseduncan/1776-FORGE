import { h, icon, clear } from "../core/dom.js";
import { get, post, patch, del, qs } from "../core/api.js";
import { ago, date, plural, n } from "../core/format.js";
import { pageHero, setTitle, empty, pagination, joinPrompt, field, bindForm, toast, modal, avatar, roleTag, notice, sectionHead } from "../core/ui.js";
import { user, can, session, signInUrl } from "../core/session.js";
import { turnstileField } from "../core/turnstile.js";

const REASONS = [["spam", "Spam or advertising"], ["harassment", "Harassment or personal attack"], ["threat", "Threat of violence"], ["personal_information", "Private personal information"], ["misinformation", "Fabricated document or claim"], ["off_topic", "Off-topic"], ["illegal", "Illegal content"], ["other", "Other"]];

export async function communityIndex({ view, params, query }) {
  const category = params.category || query.get("category") || "";
  const page = Number(query.get("page") || 1);
  const q = query.get("q") || "";
  const sort = query.get("sort") || "";
  const [cats, data] = await Promise.all([get("/api/forum/categories"), get("/api/forum/discussions" + qs({ category, page, q, sort }))]);
  const current = cats.items.find((c) => c.id === category);
  setTitle(current ? current.name + " · Community" : "Community Forum");
  view.append(pageHero({
    crumbs: current ? [{ label: "Community", href: "/community" }] : null,
    eyebrow: "Your voice belongs here",
    title: current ? current.name : "Community forum",
    lede: current ? current.description : "Free to read. Free membership to participate. Bring questions, respectful disagreement and documentation.",
    actions: user() ? h("a.btn.btn-gold", { href: "/community/new" + (category ? `?category=${category}` : "") }, icon("plus", 18), "Start a discussion") : null,
  }));
  const go = (p) => window.forgeNavigate((category ? `/community/c/${category}` : "/community") + qs({ q, sort, ...p }));
  const qInput = h("input.input", { type: "search", value: q, placeholder: "Search discussions", "aria-label": "Search discussions" });
  const listCol = h("div",
    h("form.search-panel", { role: "search", style: { marginBottom: "20px" }, onsubmit: (e) => { e.preventDefault(); go({ q: qInput.value.trim(), page: 1 }); } },
      h("div.search-bar", h("div.input-wrap", icon("search", 20), qInput), h("button.btn.btn-blue", { type: "submit" }, "Search")),
      h("div.chips", { style: { marginTop: "12px" } },
        h("button.chip", { type: "button", "aria-pressed": String(sort !== "new"), onclick: () => go({ sort: "", page: 1 }) }, "Active"),
        h("button.chip", { type: "button", "aria-pressed": String(sort === "new"), onclick: () => go({ sort: "new", page: 1 }) }, "Newest"))));
  if (!user()) listCol.append(joinPrompt());
  if (!data.items.length) listCol.append(h("div", { style: { marginTop: "16px" } }, empty({ iconName: "chat", title: q ? "No discussions match" : "No discussions here yet", text: "Be the first to ask a question or share a document. Community posts are clearly labelled as member opinion." })));
  else {
    listCol.append(h("div.grid", { style: { marginTop: "16px", gap: "12px" } }, data.items.map((d) => h("article.card.interactive",
      h("div.kicker", d.pinned ? h("span.badge.badge-gold", icon("star", 12), "Pinned") : null, d.locked ? h("span.badge", icon("lock", 12), "Locked") : null, d.category_name, d.context && h("span", "· on ", d.context.title.slice(0, 60))),
      h("h3", h("a", { href: `/community/t/${d.id}` }, d.title)),
      h("p", d.excerpt),
      h("div.card-foot", h("span", avatar({ display_name: d.author }, 24), " ", h("a", { href: `/authors/${d.author_id}`, style: { position: "relative", zIndex: 1 } }, d.author), " ", roleTag(d.author_role), ` · ${ago(d.last_activity_at)}`), h("span", icon("chat", 14), " ", plural(d.comment_count, "reply", "replies")))))));
    listCol.append(pagination(page, data.pageSize, data.total, (p) => go({ page: p })));
  }
  const side = h("aside",
    h("section.panel", h("h3", "Categories"), h("ul.related-list",
      h("li", h("a", { href: "/community", "aria-current": !category ? "page" : undefined }, icon("chat", 16), "All discussions")),
      cats.items.map((c) => h("li", h("a", { href: `/community/c/${c.id}`, "aria-current": c.id === category ? "page" : undefined }, icon("chat", 16), h("span", c.name, h("span.small.muted", ` · ${n(c.discussions)}`))))))),
    h("section.panel", h("h3", icon("shield", 14), " Community standards"),
      h("ul.list-plain", { style: { display: "grid", gap: "8px", fontSize: "0.92rem" } },
        h("li", "✓ Debate the issue, not the person."), h("li", "✓ Bring documents — link the record."), h("li", "✓ No threats, doxxing or fabricated evidence."), h("li", "✓ Moderation decisions are logged publicly.")),
      h("p.small", { style: { marginTop: "12px" } }, h("a", { href: "/standards#community" }, "Full guidelines"), " · ", h("a", { href: "/community/moderation-log" }, "Moderation log"))));
  view.append(h("div.container.section", h("div.layout-sidebar", listCol, side)));
}

export async function newDiscussion({ view, query }) {
  setTitle("Start a discussion");
  view.append(pageHero({ crumbs: [{ label: "Community", href: "/community" }], eyebrow: "Free membership", title: "Start a discussion", lede: "Ask a clear question or share what you found. Link to records so others can check the evidence." }));
  const box = h("div.container.container-narrow.section");
  view.append(box);
  if (!user()) { box.append(joinPrompt("You need a free account to start a discussion.")); return; }
  const cats = await get("/api/forum/categories");
  const form = h("form.panel",
    field({ name: "category_id", label: "Category", type: "select", required: true, value: query.get("category") || "general", options: cats.items.map((c) => ({ value: c.id, label: c.name })) }),
    field({ name: "title", label: "Title", required: true, max: 160, hint: "A specific question or topic works best." }),
    field({ name: "body", label: "Your post", type: "textarea", rows: 10, required: true, max: 20000, hint: "Plain text. Paste links to records (https://…) to support your point." }),
    turnstileField(),
    h("div.community-label", icon("users", 16), "Your post will be labelled as community opinion, distinct from Baldwin Minute Watch reporting."),
    h("div.btn-row", { style: { marginTop: "16px" } }, h("button.btn.btn-gold", { type: "submit" }, "Post discussion"), h("a.btn.btn-ghost", { href: "/community" }, "Cancel")));
  bindForm(form, async (d) => {
    const res = await post("/api/forum/discussions", { title: d.title, body: d.body, category_id: d.category_id, turnstileToken: d["cf-turnstile-response"] });
    toast(res.moderation_state === "pending" ? "Posted — held for review because it contains many links." : "Discussion posted.", "success");
    window.forgeNavigate(`/community/t/${res.id}`);
  });
  box.append(form);
}

export async function thread({ view, params, query }) {
  const page = Number(query.get("page") || 1);
  let data;
  try { data = await get(`/api/forum/discussions/${encodeURIComponent(params.id)}` + qs({ page })); }
  catch (err) { if (err.status === 404) { const { notFound } = await import("./static.js"); return notFound({ view }); } throw err; }
  const d = data.discussion;
  setTitle(d.title);
  view.append(pageHero({
    crumbs: [{ label: "Community", href: "/community" }, d.category_name && { label: d.category_name, href: `/community/c/${d.category_id}` }].filter(Boolean),
    eyebrow: "Community discussion",
    title: d.title,
    meta: h("div.btn-row", d.locked ? h("span.badge", icon("lock", 12), "Locked") : null, d.moderation_state === "pending" ? h("span.badge.badge-pending", "Awaiting review") : null, d.context ? h("a.badge.badge-gold", { href: d.context.link }, "About: ", d.context.title.slice(0, 70)) : null),
  }));
  if (d.moderation_state === "hidden") {
    view.append(h("div.container", { style: { paddingTop: "24px" } }, notice(h("span", "This discussion was removed by moderators. ", d.removal_reason ? h("strong", `Reason: ${d.removal_reason}`) : null, " See the ", h("a", { href: "/community/moderation-log" }, "moderation log"), "."), "warning", "shield")));
    // Visitors see only the notice; moderators (and the author) still see the content so it can be reviewed or restored.
    if (!data.permissions?.moderate && !d.is_own) return;
  }
  const opener = h("article.comment", { style: { borderTop: "3px solid var(--blue-600)" } },
    h("div.comment-head", avatar({ display_name: d.author }, 32), h("a", { href: `/authors/${d.author_id}` }, h("strong", d.author)), roleTag(d.author_role), h("span", "· " + date(d.created_at))),
    h("div.comment-body", d.body),
    h("div.comment-actions", user() && !d.is_own ? h("button", { type: "button", onclick: () => reportDialog("discussion", d.id) }, icon("flag", 14), " Report") : null));
  const followBtn = user() ? h("button.btn.btn-ghost.btn-sm", { type: "button", onclick: async () => {
    const next = !data.following;
    await post("/api/follows", { target_type: "discussion", target_id: d.id, follow: next });
    data.following = next;
    followBtn.lastChild.textContent = next ? "Following" : "Follow";
    toast(next ? "You'll be notified of new replies." : "Unfollowed.", "success");
  } }, icon("bell", 16), h("span", data.following ? "Following" : "Follow")) : null;

  const tree = buildTree(data.comments);
  const threadEl = h("div.thread", tree.map((c) => commentNode(c, d, data.permissions)));
  const reply = data.permissions.comment ? replyForm(d.id, null) : d.locked ? notice("This discussion is locked. Existing replies remain visible.", "warning", "lock") : joinPrompt("Sign in free to reply.");
  const modTools = data.permissions.moderate ? h("section.panel", h("h3", icon("shield", 14), " Moderator tools"), h("div.btn-row",
    modButton("discussion", d.id, d.locked ? "unlock" : "lock", d.locked ? "Unlock" : "Lock"),
    modButton("discussion", d.id, d.pinned ? "unpin" : "pin", d.pinned ? "Unpin" : "Pin"),
    d.moderation_state === "hidden" ? modButton("discussion", d.id, "restore", "Restore discussion") : modButton("discussion", d.id, "hide", "Remove discussion"))) : null;

  view.append(h("div.container.section", h("div.layout-sidebar",
    h("div.stack",
      h("div.community-label", icon("users", 16), "Community discussion — member opinion, not verified Baldwin Minute Watch reporting."),
      opener,
      h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" } }, h("h2", { style: { fontSize: "var(--fs-xl)", margin: 0 } }, plural(d.comment_count, "reply", "replies")), followBtn),
      threadEl,
      pagination(page, data.pageSize, data.total, (p) => window.forgeNavigate(`/community/t/${d.id}?page=${p}`)),
      h("section", { id: "reply" }, h("h3", "Add your reply"), reply)),
    h("aside", modTools,
      h("section.panel", h("h3", "About this thread"), h("dl.meta", h("dt", "Started"), h("dd", date(d.created_at)), h("dt", "Last activity"), h("dd", ago(d.last_activity_at)), h("dt", "Category"), h("dd", d.category_name || "—"))),
      h("section.panel", h("h3", "Standards"), h("p.small", "Replies that attack people, reveal private information or fabricate evidence are removed with a public reason. ", h("a", { href: "/community/moderation-log" }, "View the log."))))),
  ));
}

function buildTree(comments) {
  const byId = new Map(comments.map((c) => [c.id, { ...c, children: [] }]));
  const roots = [];
  for (const c of byId.values()) (c.parent_id && byId.has(c.parent_id) ? byId.get(c.parent_id).children : roots).push(c);
  return roots;
}

function commentNode(c, d, perms, depth = 0) {
  const removed = c.moderation_state === "hidden" || c.moderation_state === "deleted";
  const node = h(`article.comment${removed ? ".removed" : ""}${c.moderation_state === "pending" ? ".pending" : ""}`, { id: `c-${c.id}` });
  if (c.moderation_state === "hidden") node.append(h("div", icon("shield", 14), " Removed by moderators", c.removal_reason ? ` — ${c.removal_reason}` : ""));
  else if (c.moderation_state === "deleted") node.append(h("div", "Deleted by its author."));
  else {
    const body = h("div.comment-body", c.body ?? "");
    node.append(
      h("div.comment-head", avatar(c.author, 28), c.author ? h("a", { href: `/authors/${c.author.id}` }, h("strong", c.author.display_name)) : h("strong", "Former member"), roleTag(c.author?.role), h("span", "· " + ago(c.created_at)), c.updated_at ? h("span", "· edited") : null, c.moderation_state === "pending" ? h("span.badge.badge-pending", "Awaiting review") : null),
      body);
    const actions = h("div.comment-actions");
    const replyBox = h("div");
    if (perms.comment && depth < 5) actions.append(h("button", { type: "button", onclick: () => { clear(replyBox).append(replyForm(d.id, c.id, () => clear(replyBox))); replyBox.querySelector("textarea")?.focus(); } }, icon("chat", 14), " Reply"));
    if (c.is_own) {
      actions.append(h("button", { type: "button", onclick: () => editComment(c, body) }, icon("edit", 14), " Edit"));
      actions.append(h("button", { type: "button", onclick: async () => { if (!confirm("Delete your comment? Replies will remain.")) return; await del(`/api/comments/${c.id}`); window.forgeNavigate(location.pathname + location.search, { replace: true }); } }, "Delete"));
    } else if (user()) actions.append(h("button", { type: "button", onclick: () => reportDialog("comment", c.id) }, icon("flag", 14), " Report"));
    if (perms.moderate) actions.append(c.moderation_state === "pending" ? modButton("comment", c.id, "approve", "Approve", true) : modButton("comment", c.id, "hide", "Remove", true));
    node.append(actions, replyBox);
  }
  if (perms.moderate && c.moderation_state === "hidden") node.append(h("div.comment-actions", modButton("comment", c.id, "restore", "Restore", true)));
  if (c.children.length) node.append(h("div.replies", c.children.map((ch) => commentNode(ch, d, perms, depth + 1))));
  return node;
}

function replyForm(discussionId, parentId, onCancel) {
  const form = h("form.panel", { style: { marginTop: "10px" } },
    field({ name: "body", label: parentId ? "Your reply" : "Reply to the discussion", type: "textarea", rows: parentId ? 3 : 5, required: true, max: 10000 }),
    turnstileField(),
    h("div.btn-row", h("button.btn.btn-blue", { type: "submit" }, "Post reply"), onCancel ? h("button.btn.btn-ghost", { type: "button", onclick: onCancel }, "Cancel") : null));
  bindForm(form, async (d) => {
    const res = await post(`/api/forum/discussions/${discussionId}/comments`, { body: d.body, parent_id: parentId, turnstileToken: d["cf-turnstile-response"] });
    toast(res.moderation_state === "pending" ? "Reply held for moderator review." : "Reply posted.", "success");
    window.forgeNavigate(`${location.pathname}${location.search}#c-${res.id}`, { replace: true });
  });
  return form;
}

function editComment(c, bodyEl) {
  const form = h("form", field({ name: "body", label: "Edit comment", type: "textarea", value: c.body, required: true }), h("button.btn.btn-blue", { type: "submit" }, "Save"));
  const dlg = modal("Edit your comment", form);
  bindForm(form, async (d) => { await patch(`/api/comments/${c.id}`, { body: d.body }); bodyEl.textContent = d.body; dlg.close(); toast("Comment updated.", "success"); });
}

function reportDialog(type, id) {
  const form = h("form",
    h("p.small.muted", "Reports go to moderators. Repeated false reports may limit your account."),
    field({ name: "reason", label: "Reason", type: "select", required: true, options: REASONS.map(([value, l]) => ({ value, label: l })) }),
    field({ name: "details", label: "Details (optional)", type: "textarea", rows: 3, max: 2000 }),
    h("button.btn.btn-red", { type: "submit" }, "Send report"));
  const dlg = modal("Report content", form);
  bindForm(form, async (d) => { await post("/api/reports", { target_type: type, target_id: id, ...d }); dlg.close(); toast("Thank you — moderators will review it.", "success"); });
}

function modButton(type, id, action, text, small) {
  return h(small ? "button" : "button.btn.btn-ghost.btn-sm", { type: "button", onclick: async () => {
    let reason = null;
    if (action === "hide" || action === "lock") {
      const form = h("form", field({ name: "reason", label: "Public reason", type: "textarea", required: true, max: 2000 }),
        h("p.small.muted", "This explanation appears in the public moderation log."),
        h("button.btn.btn-red", { type: "submit" }, "Confirm moderation"));
      const dlg = modal("Moderate content", form);
      bindForm(form, async (data) => {
        await post("/api/moderation/actions", { target_type: type, target_id: id, action, reason: data.reason });
        dlg.close();
        toast("Moderation action recorded.", "success");
        window.forgeNavigate(location.pathname + location.search, { replace: true });
      });
      return;
    }
    try { await post("/api/moderation/actions", { target_type: type, target_id: id, action, reason }); toast("Moderation action recorded.", "success"); window.forgeNavigate(location.pathname + location.search, { replace: true }); }
    catch (e) { toast(e.message, "error"); }
  } }, small ? [icon("shield", 14), " ", text] : text);
}

export async function moderationLog({ view, query }) {
  setTitle("Moderation log");
  const page = Number(query.get("page") || 1);
  view.append(pageHero({ crumbs: [{ label: "Community", href: "/community" }], eyebrow: "Transparent moderation", title: "Moderation log", lede: "Every moderation action, when it happened and the public reason given. Moderators are identified by role." }));
  const data = await get("/api/moderation/log" + qs({ page }));
  const box = h("div.container.section");
  if (!data.items.length) box.append(empty({ iconName: "shield", title: "No moderation actions yet", text: "When moderators remove, restore, approve or lock content, the action appears here." }));
  else box.append(h("div.table-wrap", h("table.data", h("thead", h("tr", h("th", "Date"), h("th", "Action"), h("th", "Content"), h("th", "Reason"), h("th", "By"))),
    h("tbody", data.items.map((m) => h("tr", h("td", date(m.created_at)), h("td", h("strong", m.action.replace("_", " "))), h("td", m.target_type === "discussion" ? h("a", { href: `/community/t/${m.target_id}` }, "Discussion") : m.target_type.replace("_", " ")), h("td", m.reason || "—"), h("td", m.moderator_role || "moderator")))))));
  box.append(pagination(page, data.pageSize, data.items.length === data.pageSize ? page * data.pageSize + 1 : (page - 1) * data.pageSize + data.items.length, (p) => window.forgeNavigate(`/community/moderation-log?page=${p}`)));
  view.append(box);
}

