// Cloudflare Turnstile widget, rendered only when a site key is configured for this environment.
import { h } from "./dom.js";
import { session } from "./session.js";

let loader;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!loader) {
    loader = new Promise((resolve, reject) => {
      const s = h("script", { src: "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", async: true });
      s.onload = () => resolve(window.turnstile);
      s.onerror = () => reject(new Error("Anti-spam check failed to load"));
      document.head.append(s);
    });
  }
  return loader;
}

export function turnstileField() {
  const key = session().config?.turnstileSiteKey;
  if (!key) return null;
  const el = h("div.field", { "data-turnstile": "1" });
  loadTurnstile().then((t) => t.render(el, { sitekey: key, theme: "auto" })).catch(() => el.append(h("p.form-error", "Anti-spam check could not load. Please refresh.")));
  return el;
}
