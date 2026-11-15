// Leaflet integration. Fixes the incomplete-tile problem by (1) loading Leaflet's CSS from our own
// origin (the old CDN link had a truncated SRI hash, so the browser refused the stylesheet),
// (2) creating the map only once its container is attached and has a non-zero size, and
// (3) re-measuring with invalidateSize() whenever the container resizes or becomes visible.
import { h } from "./dom.js";

let loading;
export function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      if (!document.querySelector('link[data-leaflet]')) {
        document.head.append(h("link", { rel: "stylesheet", href: "/vendor/leaflet/leaflet.css", "data-leaflet": "1" }));
      }
      const s = h("script", { src: "/vendor/leaflet/leaflet.js" });
      s.onload = () => resolve(window.L);
      s.onerror = () => { loading = null; reject(new Error("Map library failed to load")); };
      document.head.append(s);
    });
  }
  return loading;
}

export const MILLEDGEVILLE = [33.0801, -83.2321];
export const COND_COLORS = { green: "#2e8a4f", yellow: "#d9a21b", red: "#c0392b", gray: "#7b8794" };
// Dash patterns make condition readable without relying on colour alone.
export const COND_DASH = { green: null, yellow: "10 4", red: "4 4", gray: "2 6" };

function waitForSize(el) {
  return new Promise((resolve) => {
    if (el.isConnected && el.clientWidth > 0 && el.clientHeight > 0) return resolve();
    const ro = new ResizeObserver(() => {
      if (el.isConnected && el.clientWidth > 0 && el.clientHeight > 0) { ro.disconnect(); resolve(); }
    });
    ro.observe(el);
  });
}

/** Create a Leaflet map in `el`. Returns { map, L, destroy }. */
export async function createMap(el, { center = MILLEDGEVILLE, zoom = 13, scrollWheelZoom = false } = {}) {
  const L = await loadLeaflet();
  await waitForSize(el);
  const map = L.map(el, { center, zoom, scrollWheelZoom, zoomControl: false });
  L.control.zoom({ position: "bottomright" }).addTo(map);
  L.control.scale({ imperial: true, metric: false, position: "bottomleft" }).addTo(map);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    crossOrigin: true,
  }).addTo(map);
  // Re-measure whenever the container changes size (sidebar toggles, orientation change, route reveal).
  const ro = new ResizeObserver(() => map.invalidateSize({ pan: false, debounceMoveend: true }));
  ro.observe(el);
  const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) map.invalidateSize({ pan: false }); });
  io.observe(el);
  requestAnimationFrame(() => map.invalidateSize({ pan: false }));
  // Enable wheel zoom only after the user clicks into the map, so page scrolling is not hijacked.
  map.once("focus", () => map.scrollWheelZoom.enable());
  map.on("click", () => map.scrollWheelZoom.enable());
  return { map, L, destroy: () => { ro.disconnect(); io.disconnect(); map.remove(); } };
}

export function featureStyle(f) {
  const c = f.properties?.condition_state;
  return { color: COND_COLORS[c] || "#245a9b", weight: f.properties?.kind === "boundary" ? 2 : 6, opacity: 0.92, dashArray: COND_DASH[c] || null, lineCap: "round", fillOpacity: 0.15 };
}
