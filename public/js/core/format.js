const dateFmt = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
const shortFmt = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" });
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("en-US");

/** Calendar dates (YYYY-MM-DD) are formatted in UTC so they never shift a day. */
export function date(value) {
  if (!value) return "";
  const s = String(value);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + "T00:00:00Z") : new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return s;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? dateFmt.format(d) : shortFmt.format(d);
}

export function ago(value) {
  if (!value) return "";
  const d = new Date(String(value).includes("T") ? value : String(value).replace(" ", "T") + "Z");
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  if (s < 86400 * 14) return `${Math.floor(s / 86400)} days ago`;
  return shortFmt.format(d);
}

export const cents = (c) => (c === null || c === undefined ? "—" : money.format(Number(c) / 100));
export const n = (v) => num.format(Number(v || 0));
export const plural = (count, one, many = one + "s") => `${n(count)} ${Number(count) === 1 ? one : many}`;
export const bytes = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB");

export const LABELS = {
  verification: { verified: "Verified", unreviewed: "Unreviewed", disputed: "Disputed", superseded: "Superseded", rejected: "Rejected" },
  resource: { verified: "Link verified", unverified: "Not yet checked", needs_review: "Needs review", broken: "Broken link", disabled: "Disabled" },
  level: { federal: "Federal", state: "State", county: "County", city: "Municipal", municipal: "Municipal", nonprofit: "Nonprofit", academic: "Academic", other: "Other" },
  condition: { green: "Good", yellow: "Fair / watch", red: "Poor / hazard", gray: "Not rated / unknown" },
  kind: { investigation: "Investigation", report: "Report", update: "Update", explainer: "Explainer", commentary: "Commentary" },
  textKind: { original_text: "Original text", current_authority: "Current authority", historical_version: "Historical version", judicial_interpretation: "Judicial interpretation" },
  legalStatus: { in_force: "In force", repealed: "Repealed", superseded: "Superseded", historical: "Historical", overruled: "Overruled" },
  role: { member: "Member", contributor: "Contributor", researcher: "Researcher", editor: "Editor", admin: "Administrator", owner: "Owner" },
  sourceKind: { official: "Official source", open_records_response: "Open-records response", court: "Court record", third_party: "Third-party source", community: "Community-submitted", regulatory: "Regulatory body", nonprofit: "Nonprofit", academic: "Academic", news: "News" },
};

export const label = (group, key) => LABELS[group]?.[key] || (key ? String(key).replace(/_/g, " ") : "");

export function initials(name) {
  return String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("");
}

export function roman(n) {
  const map = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = "";
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}
