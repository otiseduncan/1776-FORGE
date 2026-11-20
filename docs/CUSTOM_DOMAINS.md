# Staging custom domains

The owner confirmed the domains were already purchased and corrected their spelling on November 20, 2026.

- `https://baldwinminutewatch.com`
- `https://baldwinminutewatch.org`

Both apex hostnames are attached as Cloudflare Worker Custom Domains to `1776-forge-staging`. The routes are recorded in `wrangler.consolidation-preview.json` so future deployments with that configuration retain the domains. The existing workers.dev staging URL remains available.

The `www` form of each domain is also attached and redirects with HTTP 308 to its matching HTTPS apex. HTTP requests to either bare domain are also redirected to HTTPS so sign-in always uses the registered secure callback. Record paths and query strings are retained. This gives each domain a single session/OAuth hostname and prevents missing-www DNS failures.

The earlier, misspelled `baldwinminutewach.com` and `baldwinminutewach.org` Worker attachments were removed. Their domain registrations were not deleted or altered. No domain purchase or payment was made by the agent.

Google OAuth client `90816671582-ubot1ro6sg9jnd6725l21hd5b7su0q0o.apps.googleusercontent.com` now retains both new HTTPS JavaScript origins and these redirect URIs:

```text
https://baldwinminutewatch.com/api/auth/google/callback
https://baldwinminutewatch.org/api/auth/google/callback
```

The existing FORGE and workers.dev staging redirect URIs were retained. No client secret was changed. Google confirmed the save, and reopening the client showed both origins and callback URIs persisted. Provider propagation may delay new sign-in routes.

This is a connection to staging, not a promotion to production data. APP_ENV remains staging, database/file bindings are unchanged, and pages continue to advertise noindex. The older production website and original FORGE production deployment remain unchanged. The production readiness gates in BMW_CONSOLIDATION.md still apply.

Cloudflare attachment metadata and DNS/HTTPS verification are recorded in the deliverable Domain_Connection_Report.json and Domain_HTTPS_Verification.json. Read the latest verification results to distinguish configured routing from completed public DNS/certificate propagation.
