// Context discussions panel shown on articles, records, map features, legal authorities and meetings.
import { h, icon } from "./dom.js";
import { post } from "./api.js";
import { user, can } from "./session.js";
import { bindForm, field, joinPrompt, toast } from "./ui.js";
import { ago, plural } from "./format.js";
import { turnstileField } from "./turnstile.js";

export function discussionPanel({ contextType, contextId, contextTitle, discussions = [] }) {
  const wrap = h("section.panel", { id: "discussion", "aria-labelledby": "disc-title" },
    h("h3#disc-title", icon("chat", 14), " Community discussion"),
    h("div.community-label", icon("users", 16), h("span", "Community posts are member opinion, not verified Baldwin Minute Watch reporting.")));
  const list = h("ul.related-list", { style: { marginTop: "12px" } }, discussions.map((d) => h("li", h("a", { href: `/community/t/${d.id}` }, icon("chat", 16), h("span", d.title, h("span.small.muted", ` · ${plural(d.comment_count, "comment")} · ${ago(d.last_activity_at)}`))))));
  if (discussions.length) wrap.append(list);
  else wrap.append(h("p.muted.small", { style: { marginTop: "12px" } }, "No discussion has started yet."));

  if (!user()) { wrap.append(joinPrompt("Free members can start a discussion about this item.")); return wrap; }
  if (!can("community.post")) return wrap;
  const toggle = h("button.btn.btn-ghost.btn-sm", { type: "button" }, icon("plus", 16), "Start a discussion");
  const form = h("form", { hidden: true, style: { marginTop: "12px" } },
    field({ name: "title", label: "Discussion title", value: contextTitle ? `Discussion: ${contextTitle}`.slice(0, 150) : "", required: true, max: 160 }),
    field({ name: "body", label: "Your post", type: "textarea", required: true, rows: 5, max: 20000, hint: "Bring documents: link records, cite pages, keep it civil." }),
    turnstileField(),
    h("button.btn.btn-blue", { type: "submit" }, "Post discussion"));
  bindForm(form, async (data) => {
    const res = await post("/api/forum/discussions", { title: data.title, body: data.body, context_type: contextType, context_id: contextId, turnstileToken: data["cf-turnstile-response"] });
    toast(res.moderation_state === "pending" ? "Posted — held for moderator review." : "Discussion started.", "success");
    window.forgeNavigate(`/community/t/${res.id}`);
  });
  toggle.addEventListener("click", () => { form.hidden = !form.hidden; toggle.hidden = true; form.querySelector("input")?.focus(); });
  wrap.append(h("div", { style: { marginTop: "12px" } }, toggle), form);
  return wrap;
}
