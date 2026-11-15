// Minimal, XSS-safe DOM builder. Text is always inserted with textContent; HTML strings are never parsed.

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * h("div.card#id", { onclick, class, attrs... }, children...)
 * Children may be strings, numbers, nodes, arrays, null/false (skipped).
 */
export function h(tag, props, ...children) {
  if (props === null || typeof props !== "object" || props instanceof Node || Array.isArray(props)) {
    if (props !== undefined) children.unshift(props);
    props = {};
  }
  const [name, ...rest] = tag.split(/(?=[.#])/);
  const el = document.createElement(name || "div");
  for (const part of rest) {
    if (part.startsWith(".")) el.classList.add(part.slice(1));
    else if (part.startsWith("#")) el.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class" || k === "className") String(v).split(/\s+/).filter(Boolean).forEach((c) => el.classList.add(c));
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "href" || k === "src") {
      const s = String(v);
      if (/^\s*(javascript|data|vbscript):/i.test(s)) continue; // never render script URLs
      el.setAttribute(k, s);
    } else if (k === "html") throw new Error("Raw HTML is not permitted");
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === true) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// 24×24 stroke icons drawn for FORGE (simple geometric paths).
const ICONS = {
  search: ["M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z", "M20 20l-4.2-4.2"],
  menu: ["M4 7h16", "M4 12h16", "M4 17h16"],
  close: ["M6 6l12 12", "M18 6L6 18"],
  doc: ["M7 3h7l5 5v13H7z", "M14 3v5h5", "M10 13h6", "M10 17h6"],
  map: ["M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z", "M9 4v14", "M15 6v14"],
  pin: ["M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z", "M12 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"],
  scale: ["M12 4v16", "M6 20h12", "M5 8h14", "M5 8l-3 6a3 3 0 0 0 6 0z", "M19 8l-3 6a3 3 0 0 0 6 0z", "M12 4l-1 0"],
  news: ["M4 5h13v14H6a2 2 0 0 1-2-2z", "M17 9h3v8a2 2 0 0 1-2 2", "M7 9h7", "M7 13h7", "M7 17h4"],
  users: ["M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z", "M2.5 20a6.5 6.5 0 0 1 13 0", "M16 4.5a3.5 3.5 0 0 1 0 6.8", "M18 14a6.5 6.5 0 0 1 3.5 6"],
  building: ["M3 21h18", "M5 21V10l7-5 7 5v11", "M9 21v-6h6v6", "M9 11h.01", "M15 11h.01"],
  link: ["M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1", "M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"],
  external: ["M14 4h6v6", "M20 4l-9 9", "M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"],
  star: ["M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"],
  check: ["M5 12.5l4.5 4.5L19 7.5"],
  shield: ["M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z", "M8.5 12l2.5 2.5 4.5-5"],
  alert: ["M12 3l10 18H2z", "M12 10v4", "M12 17.5h.01"],
  info: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 11v6", "M12 7.5h.01"],
  download: ["M12 4v11", "M7 10l5 5 5-5", "M5 20h14"],
  eye: ["M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z", "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"],
  bell: ["M6 16V11a6 6 0 1 1 12 0v5l2 2H4z", "M10 20a2 2 0 0 0 4 0"],
  user: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M4 21a8 8 0 0 1 16 0"],
  plus: ["M12 5v14", "M5 12h14"],
  arrow: ["M5 12h14", "M13 6l6 6-6 6"],
  chat: ["M4 5h16v11H9l-5 4z", "M8 10h8", "M8 13h5"],
  flag: ["M5 21V4", "M5 4h11l-2 4 2 4H5"],
  gavel: ["M14 4l6 6", "M11 7l6 6", "M12.5 5.5l-6 6", "M3 21l7-7", "M4 20l3 0"],
  book: ["M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z", "M4 19V5", "M9 7h6"],
  vote: ["M4 12l4 4 8-9", "M4 20h16"],
  coins: ["M8 7a5 2 0 1 0 0 .01", "M3 7v4c0 1.1 2.2 2 5 2s5-.9 5-2V7", "M11 13v4c0 1.1 2.2 2 5 2s5-.9 5-2v-4", "M11 13c0-1.1 2.2-2 5-2s5 .9 5 2"],
  layers: ["M12 3l9 5-9 5-9-5z", "M3 13l9 5 9-5"],
  edit: ["M4 20h4L19 9l-4-4L4 16z", "M13.5 6.5l4 4"],
  logout: ["M10 4H5v16h5", "M15 8l4 4-4 4", "M19 12H9"],
  settings: ["M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z", "M19 12l2-1-1-3-2 .2-1.4-1.4.2-2-3-1-1 2h-2l-1-2-3 1 .2 2L5.6 7.2 3.6 7 2.6 10l2 1v2l-2 1 1 3 2-.2 1.4 1.4-.2 2 3 1 1-2h2l1 2 3-1-.2-2 1.4-1.4 2 .2 1-3-2-1z"],
  lock: ["M6 11h12v10H6z", "M8 11V8a4 4 0 0 1 8 0v3"],
  sun: ["M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", "M12 2v2", "M12 20v2", "M4.9 4.9l1.4 1.4", "M17.7 17.7l1.4 1.4", "M2 12h2", "M20 12h2", "M4.9 19.1l1.4-1.4", "M17.7 6.3l1.4-1.4"],
  calendar: ["M4 6h16v15H4z", "M4 10h16", "M8 3v5", "M16 3v5"],
  upload: ["M12 20V9", "M7 14l5-5 5 5", "M5 4h14"],
};

export function icon(name, size = 20, label) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  if (label) { svg.setAttribute("role", "img"); svg.setAttribute("aria-label", label); }
  else svg.setAttribute("aria-hidden", "true");
  for (const d of ICONS[name] || ICONS.info) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  return svg;
}
