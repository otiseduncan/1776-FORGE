import { get, post, setCsrf } from "./api.js";

const state = { me: null, config: null, loaded: false, listeners: new Set() };

export async function loadSession(force = false) {
  if (state.loaded && !force) return state;
  const [me, config] = await Promise.all([
    get("/api/me").catch(() => ({ user: null, capabilities: [] })),
    state.config ? Promise.resolve(state.config) : get("/api/config").catch(() => ({ authConfigured: false, databaseConfigured: false })),
  ]);
  state.me = me;
  state.config = config;
  state.loaded = true;
  setCsrf(me?.csrfToken);
  for (const fn of state.listeners) fn(state);
  return state;
}

export const session = () => state;
export const user = () => state.me?.user || null;
export const can = (cap) => !!state.me?.capabilities?.includes(cap);
export const onSession = (fn) => { state.listeners.add(fn); return () => state.listeners.delete(fn); };

export function signInUrl(returnTo = location.pathname + location.search) {
  return `/api/auth/google/start?return=${encodeURIComponent(returnTo)}`;
}

export async function signOut() {
  await post("/api/auth/logout").catch(() => {});
  await loadSession(true);
}
