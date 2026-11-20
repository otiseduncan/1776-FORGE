/** Hash URLs are not sent to Workers. Translate legacy record links in the browser. */
export function legacyRecordPath(pathname, search, hash) {
  if (pathname === "/document") {
    const id = new URLSearchParams(search).get("id");
    if (id) return `/legacy/records/${encodeURIComponent(id)}${/^#page=\d+$/.test(hash) ? hash : ""}`;
  }
  if (pathname !== "/") return null;
  if (/^#\/(?:map|project|road|report|county)(?:[/?]|$)/.test(hash)) return "/legacy-map" + search + hash;
  if (/^#\/records(?:[?]|$)/.test(hash)) return "/legacy/records";
  if (/^#\/forum(?:[?]|$)/.test(hash)) return "/legacy/community";
  const thread = hash.match(/^#\/forum\/([^?]+)(?:\?.*)?$/);
  if (thread) {
    try { return `/legacy/community/${encodeURIComponent(decodeURIComponent(thread[1]))}`; } catch { return null; }
  }
  const match = hash.match(/^#\/record\/([^?]+)(?:\?(.*))?$/);
  if (!match) return null;
  let id;
  try { id = decodeURIComponent(match[1]); } catch { return null; }
  const page = new URLSearchParams(match[2] || "").get("p");
  return `/legacy/records/${encodeURIComponent(id)}${page && /^\d+$/.test(page) ? `#page=${page}` : ""}`;
}
