// Safe Markdown subset → DOM nodes. Supports headings (##, ###), paragraphs, bullet and numbered
// lists, blockquotes, **bold**, *italic*, `code` and [links](https://…). No raw HTML is ever parsed.
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

export function renderMarkdown(src) {
  const root = h("div.prose");
  const lines = String(src || "").replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if ((m = /^(#{2,4})\s+(.*)$/.exec(line))) {
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
      while (i < lines.length && lines[i].trim() && !/^(#{2,4}\s|>|\s*[-*]\s|\s*\d+[.)]\s)/.test(lines[i])) { parts.push(lines[i].trim()); i++; }
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
