# Production domain repair — November 20, 2026

The tested Baldwin Minute Watch consolidation build was promoted from staging to `1776-forge` under the owner's explicit emergency deployment authorization. Production uses the existing `forge-db` (`70520726-5e87-48e1-bf77-1b092bce0d59`) and `forge-documents`. No database import, migration, reset or staging-data copy was performed.

Production version: `6e9bd574-4b14-4ced-8602-ca7344aec63e`.
Previous production version: `451ba542-4baf-44e4-b2d5-816f7ac81525`.

All four correct custom domains are attached to `1776-forge`. The apex domains return HTTPS 200; each www hostname returns 308 to its matching apex, preserving path and query. HTTP returns 301 to HTTPS at the zone edge. Both zones enforce Always Use HTTPS and minimum TLS 1.2. HSTS remains disabled. Existing Cloudflare Workers DNS placeholder records and certificates were retained.

The deployment was first uploaded with the production configuration without routes. The production workers.dev homepage and APIs were verified before moving domains. Cloudflare's Workers `/workers/scripts/1776-forge/domains/records` operation was used with `override_existing_origin: true`, `override_existing_dns_record: false` and the four existing origins. A prior direct PUT to the account domains endpoint returned 409 without changing assignments. No delete/recreate gap was introduced.

`wrangler.production.json` owns production bindings and custom domains. `wrangler.consolidation-preview.json` has no production domains. The package deploy commands select these files explicitly and preserve existing secrets using `--keep-vars`.

Validation: TypeScript and frontend checks passed; 68 integration tests passed. Real requests verified all four hostnames using public DNS and normal certificate verification, then all four passed using the system resolver too. Both apex domains passed homepage, news, community, Forge, health, records, original file download, article URLs and covers, Google OAuth callback configuration and anonymous permission checks. Existing Owner Google sign-in completed on the .com domain in a browser. Production counts before/after match: 1,401 documents, 25 articles, four published investigations, one user, zero discussions/comments and four media assets. Legacy archive APIs, community threads, original map transition and the performance-review PDF passed on both domains. Community write/moderation flows were tested in isolated staging; no production test posts were created.

The production Worker retains `LEGACY_RECORDS` -> `baldwin-minute-watch-v21` and `LEGACY_MAP` -> `bmw-legacy-consolidation-preview`. The original `baldwin-minute-watch-map` Worker, databases and archive storage remain intact. Existing legacy URL compatibility is retained. Staging and workers.dev URLs remain available for transition.

## Rollback

If application code fails, run `wrangler rollback 451ba542-4baf-44e4-b2d5-816f7ac81525 --config wrangler.production.json --message "Rollback authorized domain repair"` from this repository. This restores the previous Worker version without replacing production data. Confirm D1/R2 bindings afterward. The prior version lacks consolidation routes/branding, so use this only for a failed application release.

If only domain reassignment must be reversed, keep both Workers running and use the same Cloudflare domain-records operation targeting `1776-forge-staging` with the saved four origins. Never delete custom domains first and never restore the staging database over production. Re-test DNS, TLS, deep links, article/file responses and health after any rollback. Saved before-state settings, deployments and raw deployed sources accompany the preservation evidence.

Logging sampling was left unchanged to preserve diagnosis during transition. No paid upgrade was made.
