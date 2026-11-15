# Phase 2: implementation status
## Implemented in code
- Map container resize handling, delayed initialization and readiness for verified GeoJSON layers.
- Public, read-only D1 endpoints for records and map features with parameterized searching.
- D1 curated-resource seed migration and fallback directory.
- Dynamic record search (enabled when a NEW D1 is connected).
- Writes remain disabled pending secure Google sign-in, server-side permissions and moderation.

## Required account setup
Create a separate D1 database named 1776-forge-db in the owner's Cloudflare account. Add DB binding in wrangler.jsonc with its NEW database ID. Run local migrations and test. Only then run remote migrations against this confirmed new D1. Configure a separate R2 bucket for eventual original document import.

## Outstanding milestones
Google OIDC and sessions; actual forum comments; newsroom editor; legal case research; document originals in new R2; external archive inventory/export/hash validation/import; real historical GIS features; authorized banner asset upload; comprehensive integration/security tests; production deployment.

## Re-examination checkpoint
After the newly isolated D1 is configured, migrations run, records search returns data, and the map loads fully without missing tiles. Do not begin legacy migration before verifying independent backups, object inventory, hashes and row counts.

## Privacy
All added API endpoints are GET-only. Do not put secrets in GitHub or expose production legacy bindings.
