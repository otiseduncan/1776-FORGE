// Safe Markdown subset → DOM nodes. Supports headings (##, ###), paragraphs, bullet and numbered
// lists, blockquotes, tables, horizontal rules, images from the FORGE media library, **bold**, *italic*, `code`
// and [links](https://…). No raw HTML is ever parsed.
import { h } from "./dom.js";

function inline(text) {
  const out = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(((?:https?:\/\/|\/)[^\s)]+)\))/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[2]) out.push(h("strong", m[2]));
    else if (m[3]) out.push(h("em", m[3]));
    else if (m[4]) out.push(h("code", m[4]));
    else if (m[5]) {
      const external = /^https?:/.test(m[6]);
      out.push(h("a", { href: m[6], ...(external ? { target: "_blank", rel: "noopener noreferrer" } : {}) }, m[5]));
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const splitRow = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const isTableSep = (line) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line || "");
const isRule = (line) => /^\s*(-{3,}|\*{3,})\s*$/.test(line);
const BLOCK_START = /^(#{2,4}\s|>|\s*[-*]\s|\s*\d+[.)]\s|!\[)/;
const MEDIA_IMAGE = /^!\[([^\]]*)\]\((\/api\/media\/[a-z0-9-]+\/file)\)\s*$/i;

export function renderMarkdown(src) {
  const root = h("div.prose");
  const lines = String(src || "").replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if (isRule(line)) {
      root.append(h("hr"));
      i++;
    } else if ((m = MEDIA_IMAGE.exec(line))) {
      // Only images from the FORGE media library render; anything else stays as text.
      root.append(h("figure.inline-figure", h("img", { src: m[2], alt: m[1], loading: "lazy", decoding: "async" }), m[1] ? h("figcaption", m[1]) : null));
      i++;
    } else if (line.includes("|") && isTableSep(lines[i + 1])) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) => (c.endsWith(":") ? "right" : null));
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) { rows.push(splitRow(lines[i])); i++; }
      const cell = (tag, c, k, extra = {}) => h(tag, { ...extra, style: align[k] ? { textAlign: align[k] } : undefined }, inline(c));
      root.append(h("div.table-wrap", h("table.data",
        h("thead", h("tr", head.map((c, k) => cell("th", c, k, { scope: "col" })))),
        h("tbody", rows.map((r) => h("tr", r.map((c, k) => cell("td", c, k))))))));
    } else if ((m = /^(#{2,4})\s+(.*)$/.exec(line))) {
      root.append(h(m[1].length === 2 ? "h2" : m[1].length === 3 ? "h3" : "h4", inline(m[2])));
      i++;
    } else if (/^\s*[-*]\s+/.test(line)) {
      const ul = h("ul");
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { ul.append(h("li", inline(lines[i].replace(/^\s*[-*]\s+/, "")))); i++; }
      root.append(ul);
    } else if (/^\s*\d+[.)]\s+/.test(line)) {
      const ol = h("ol");
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { ol.append(h("li", inline(lines[i].replace(/^\s*\d+[.)]\s+/, "")))); i++; }
      root.append(ol);
    } else if (/^>\s?/.test(line)) {
      const parts = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { parts.push(lines[i].replace(/^>\s?/, "")); i++; }
      root.append(h("blockquote", inline(parts.join(" "))));
    } else {
      const parts = [];
      while (i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i]) && !isRule(lines[i]) && !(lines[i].includes("|") && isTableSep(lines[i + 1]))) { parts.push(lines[i].trim()); i++; }
      root.append(h("p", inline(parts.join(" "))));
    }
  }
  return root;
}

/** Convert a supported video URL into a privacy-friendly embed URL, or null. */
export function embedUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(u.pathname.slice(1))}`;
    if (u.hostname.endsWith("youtube.com")) {
      const id = u.searchParams.get("v") || u.pathname.split("/").pop();
      return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` : null;
    }
    if (u.hostname === "vimeo.com") return `https://player.vimeo.com/video/${encodeURIComponent(u.pathname.split("/").filter(Boolean)[0] || "")}`;
    if (u.hostname === "player.vimeo.com") return u.toString();
    if (u.hostname === "archive.org") return u.toString().replace("/details/", "/embed/");
    if (u.hostname === "www.c-span.org") return null;
  } catch { /* ignore */ }
  return null;
}
