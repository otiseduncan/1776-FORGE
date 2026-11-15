import type { Env } from "./env.ts";
import { Ctx, Router } from "./lib/context.ts";
import { HttpError, errorResponse, json } from "./lib/http.ts";
import { registerAuth } from "./routes/auth.ts";
import { registerRecords } from "./routes/records.ts";
import { registerLinks } from "./routes/links.ts";
import { registerMap } from "./routes/map.ts";
import { registerCommunity } from "./routes/community.ts";
import { registerNews } from "./routes/news.ts";
import { registerLaw } from "./routes/law.ts";
import { registerResources, runLinkChecks } from "./routes/resources.ts";
import { registerCivic } from "./routes/civic.ts";
import { registerAdmin } from "./routes/admin.ts";
import { registerDiscovery } from "./routes/discovery.ts";

const router = new Router();
router.get("/api/health", (c) => json({ ok: true, databaseConfigured: !!c.env.DB, storageConfigured: !!c.env.DOCS, environment: c.env.APP_ENV || "development" }));
registerAuth(router);
registerRecords(router);
registerLinks(router);
registerMap(router);
registerCommunity(router);
registerNews(router);
registerLaw(router);
registerResources(router);
registerCivic(router);
registerAdmin(router);
registerDiscovery(router);

const API_SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "cross-origin-resource-policy": "same-origin",
};

export async function handleApi(request: Request, env: Env, exec?: ExecutionContext): Promise<Response> {
  const c = new Ctx(request, env, exec);
  let res: Response;
  try {
    const m = router.match(request.method.toUpperCase(), c.url.pathname);
    if (!m) throw new HttpError(404, "API endpoint not found");
    if ("allowed" in m) {
      res = json({ error: "Method not allowed" }, 405, { allow: [...new Set(m.allowed)].join(", ") });
    } else {
      c.params = m.params;
      res = await m.handler(c);
    }
  } catch (err) {
    res = errorResponse(err);
  }
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(API_SECURITY_HEADERS)) if (!headers.has(k)) headers.set(k, v);
  return new Response(request.method === "HEAD" ? null : res.body, { status: res.status, statusText: res.statusText, headers });
}

export default {
  async fetch(request: Request, env: Env, exec: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env, exec);
    return env.ASSETS.fetch(request);
  },

  /** Weekly link verification for the resource directory (see triggers in wrangler.jsonc). */
  async scheduled(_event: ScheduledController, env: Env, exec: ExecutionContext): Promise<void> {
    if (!env.DB) return;
    exec.waitUntil(runLinkChecks(env.DB, 40).then((n) => console.log(`Checked ${n} resource links`)));
  },
} satisfies ExportedHandler<Env>;
