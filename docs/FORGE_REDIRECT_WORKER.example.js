// Reviewed transition example only. Do not deploy until the official hostname passes validation.
const OFFICIAL_ORIGIN = "https://baldwin-minute-watch-map.otiseduncan.workers.dev";
export default {
  async fetch(request) {
    const source = new URL(request.url);
    if (!["GET", "HEAD"].includes(request.method)) {
      return Response.json({ error: "This address has moved. Sign in again at Baldwin Minute Watch.", origin: OFFICIAL_ORIGIN }, { status: 410 });
    }
    // Start with 307 for a reversible transition; review a later permanent redirect separately.
    // No fragment is supplied, so browsers retain the incoming URL fragment.
    return Response.redirect(OFFICIAL_ORIGIN + source.pathname + source.search, 307);
  }
};
