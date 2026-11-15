# Agent instructions for Codex / Claude

1. This repository is the **new** 1776 FORGE application. Never edit or deploy the legacy Baldwin Minute Watch website, Worker, database, bucket, or DNS.
2. Read docs/BLUEPRINT.md before planning or modifying code. Respect all product requirements and the reference image design system across every page.
3. Use only NEW Cloudflare resources: Worker, D1, R2 and staging domain. Do not overwrite existing Cloudflare bindings or environments.
4. Preserve archive data and original files using export/inventory/hash/reconciliation. Never assume importing document metadata is sufficient.
5. The forum is public to read and free to post for signed-in members; do not put the forum behind a paywall. Keep maps and public records freely readable.
6. Implement secure Google OIDC and server-side permission checks before permitting write operations. Keep endpoints closed until secure.
7. Never fabricate imported records, county road classifications, meeting votes, or constitutional holdings. Label examples and incomplete modules.
8. Maintain source provenance, legal versioning, audit logs, and transparent moderation actions.
9. Run npm run check and integration tests after modifications. Do not claim deployment or migration is complete without verification.
10. Work feature-completely against the blueprint: schema, API, tests, frontend, security, migration and deployment instructions. Provide an honest gap report.
