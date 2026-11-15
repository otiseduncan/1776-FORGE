import { h, icon } from "../core/dom.js";
import { pageHero, setTitle } from "../core/ui.js";

export function notFound({ view }) {
  setTitle("Page not found");
  view.append(h("div.container.section", h("div.error-page",
    h("div.code", "404"),
    h("h1", "This page isn't in the archive"),
    h("p.muted", { style: { maxWidth: "520px", margin: "0 auto 24px" } }, "The link may be mistyped, or the item may have been moved or withdrawn. Withdrawn records keep a public note explaining why."),
    h("div.btn-row", { style: { justifyContent: "center" } },
      h("a.btn.btn-gold", { href: "/" }, "Return home"),
      h("a.btn.btn-ghost", { href: "/search" }, icon("search", 16), "Search FORGE"),
      h("a.btn.btn-ghost", { href: "/records" }, icon("doc", 16), "Browse records")))));
}

const SECTIONS = [
  ["editorial", "Editorial standards", [
    ["Evidence before conclusions", "Every factual claim in FORGE reporting links to the record it rests on — a public document, an official recording or an on-the-record source. If we cannot show it, we do not assert it."],
    ["Reporting, commentary and community are separate", "Investigations and reports are labelled by kind. Commentary is labelled as opinion. Community discussions are member opinion and are visually distinct from FORGE reporting."],
    ["Two-person publishing", "A contributor drafts; a different editor reviews and publishes. Published edits keep a version history with a change note."],
    ["Corrections are public", "Errors are corrected in place with a dated correction notice. We do not silently rewrite published work."],
    ["No invented data", "We never fabricate records, votes, road conditions, budgets or court holdings. Where information is missing, the page says so."],
  ]],
  ["records", "Records and provenance", [
    ["Originals are preserved", "Uploaded files are stored unchanged with a SHA-256 fingerprint. Integrity checks confirm the stored file still matches."],
    ["Verification is explicit", "Records are marked unreviewed, verified, disputed or superseded. Verification means an editor confirmed the record's source — not that its contents are true."],
    ["Source classification", "Each record states where it came from: an official publication, an open-records response, a court filing, a third party or a community submission."],
  ]],
  ["law", "Legal information", [
    ["Primary sources first", "Constitutional and statutory text links to the National Archives, the U.S. Code, Congress.gov and official state publications."],
    ["Layers are labelled", "Original text, current authority, historical versions, judicial interpretation, FORGE commentary and community opinion are always kept apart."],
    ["Not legal advice", "FORGE provides legal information from primary sources. It is not a law firm and cannot advise you about your situation."],
  ]],
  ["community", "Community guidelines", [
    ["Reading is free; posting is free", "Anyone can read the forum. Any signed-in member can post. FORGE does not charge for participation."],
    ["Argue the issue, respect the person", "Criticise decisions and public conduct of officials freely. Harassment, slurs and personal attacks on members are removed."],
    ["No threats, no doxxing", "Threats of violence and the publication of private personal information (home addresses, phone numbers, family details of private people) are removed and may end your membership."],
    ["Bring the evidence", "Link records when you make factual claims. Fabricated or altered documents are removed."],
    ["Transparent moderation", "Removals and locks carry a public reason in the moderation log. Members are notified when their content is actioned."],
  ]],
  ["privacy", "Privacy", [
    ["What we collect", "When you sign in with Google we receive your name, verified email address and profile photo. We store your posts, follows, reports and notifications."],
    ["What we don't do", "We do not sell personal data, run advertising trackers or take payments. Your email is never shown publicly."],
    ["Sessions and cookies", "We set a secure, HTTP-only session cookie when you sign in and a sign-in cookie during the Google flow. Nothing else."],
    ["Your choices", "You can edit your profile, sign out on every device, or delete your account from the Account page. Deletion removes your personal details and attributes past posts to “Former member”."],
  ]],
];

export function standards({ view }) {
  setTitle("Standards, guidelines & privacy");
  view.append(pageHero({ eyebrow: "How FORGE works", title: "Standards, guidelines & privacy", lede: "The rules we hold our reporting, our archive and our community to." }));
  view.append(h("div.container.section", h("div.legal-index",
    h("nav.legal-nav", { "aria-label": "Sections" }, SECTIONS.map(([id, name]) => h("a", { href: `#${id}` }, name))),
    h("div.stack", SECTIONS.map(([id, name, items]) => h("section.panel", { id, style: { scrollMarginTop: "100px" } },
      h("h2", { style: { fontSize: "var(--fs-2xl)", marginTop: 0 } }, name),
      h("dl.standards", items.map(([t, d]) => [h("dt", t), h("dd", d)]))))))));
}
