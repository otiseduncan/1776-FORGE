# Implementation status

Last updated 2026-11-15 on branch `claude/1776-forge-audit-architecture-4270ca`.

## How this was verified

- `npm run check` passes: the TypeScript Worker type-checks and all 25 frontend modules pass a syntax check.
- `npm test` passes: 54 integration tests (auth/OIDC, records, community, newsroom, map, law, civic, admin, links, legacy tooling). They run against the real Worker router, a D1-compatible SQLite shim and an in-memory R2.
- Browser checks ran on local `wrangler dev` with a local D1 at 1280 px, 768 px (tablet, dark mode) and 375 px (mobile). They covered every route in the route table:
  - no horizontal page overflow and no render errors;
  - no CSP violations;
  - map tiles fully loaded on desktop and mobile;
  - signed-in flows exercised through the UI: start a discussion, reply, nested reply, draft an article with live preview, workflow buttons, create a governing body and a meeting, and the source-required rejection.
- **Not verified:** real Google sign-in, which needs an OAuth client; any remote Cloudflare resource; deployment; legacy migration.

## Legend

| Status | Meaning |
|---|---|
| ✅ | Fully implemented and tested |
| 🔑 | Implemented but awaiting external configuration |
| 🟡 | Partially implemented |
| ⬜ | Not yet implemented |

## Visual redesign

| Feature | Status | Notes |
|---|---|---|
| Brand system (tokens, typography, light and dark surfaces, reduced motion) | ✅ | Built from the approved banner art (`brand/originals`, hashes in the commit) and the approved palette. |
| Homepage, 12 sections | ✅ | Masthead/nav, hero, featured investigations, latest reporting, records search, map preview, Constitution feature, community, resources, jurisdiction explorer and footer. Sections with no data show honest empty states. |
| Redesign on every page | ✅ | Investigations, article, records, record detail, map, government, law, resources, forum, thread, sign-in, account, profiles, notifications, workspace, admin, search, standards, 404 and mobile navigation. |
| Responsive layouts | ✅ | Checked at desktop, tablet and mobile. The nav drawer is used at 1180 px and below. |

## Functional systems

| Area | Feature | Status | Notes |
|---|---|---|---|
| **Records** | D1 schema, jurisdictions, agencies, categories, dates, filters, search, sorting, pagination | ✅ | |
| | Original upload to R2 (MIME sniffing, size limit, immutable, SHA-256), download, PDF preview, integrity re-check | ✅ (local) / 🔑 (remote) | Needs the new R2 bucket remotely. |
| | Verification states (editor-only), citations, relationships, duplicate detection (title/date and SHA) | ✅ | |
| | UI for creating jurisdictions and agencies | 🟡 | API only (`POST /api/jurisdictions`, `/api/agencies`). |
| | Full-text search (FTS5) | ⬜ | Search uses escaped `LIKE` across 7 content types. FTS5 is deferred until real data volume is known. |
| **Map** | Leaflet with fixed tiles (vendored CSS/JS, size-aware init, ResizeObserver) | ✅ | Root cause: truncated SRI hash on the old CDN CSS, plus initializing while the container was hidden. |
| | Features as GeoJSON (road/project/facility/boundary), condition colors green/yellow/red/gray, source required for ratings | ✅ | |
| | Member problem reports, photos, moderation queue, review notifications | ✅ | |
| | Real GIS layers | ⬜ | **No map data is seeded.** Road classifications and conditions must come from cited sources (GDOT, county) and must never be estimated. |
| | Drawing tool | 🟡 | Geometry is entered as pasted GeoJSON in the workspace. There is no on-map drawing yet. |
| **Forum** | Public to read and free to post; categories; threaded replies (depth 6); pagination; edit and delete | ✅ | |
| | Reports, follows, in-app notifications, moderation queue, public moderation log, lock/pin/hide with public reason | ✅ | |
| | Spam controls: per-user rate limit, duplicate-post block, link-heavy posts held for review | ✅ | |
| | Turnstile on posts | 🔑 | Enforced only when `TURNSTILE_SECRET_KEY` is set. |
| | Email notifications | ⬜ | In-app only. |
| **Google SSO** | OIDC with PKCE, state, nonce, ID-token signature and claims verification, hashed sessions, CSRF, logout, revoke all, account deletion | ✅ (tests) / 🔑 (live) | Needs a Google OAuth client. |
| | Roles: member, contributor, researcher, editor, admin, owner, plus server-side capabilities; owner bootstrap via `OWNER_EMAILS` | ✅ | No hardcoded admin. Role changes need a reason and are audited. |
| **Newsroom** | Drafts, submit, second-editor review and publish, return with notes, featured, archive, categories, tags, video embeds, citations, related records, corrections, version history, author pages, discussions | ✅ | |
| | Scheduled publishing, image uploads in articles | ⬜ | |
| **Constitution and law** | Declaration, Constitution articles I–VII, Bill of Rights, Amendments I–XXVII with ratification dates, Georgia constitution, Georgia Open Records and Open Meetings Acts, FOIA | ✅ | These are **metadata and links** to official sources (National Archives, Constitution Annotated on Congress.gov, uscode.house.gov, law.georgia.gov). |
| | Separation of text, authority, history, interpretation, commentary and opinion layers | ✅ | |
| | Verified legal text stored in FORGE | ⬜ | The schema requires `body_text_source`. No text has been imported. |
| | Case law | ⬜ | Entry requires citation, court and date. **No cases are seeded**, by design: no fabricated holdings. |
| **Resources** | 26 resources with metadata, search, level/topic filters, admin edit, link checking (manual, batch, weekly cron) | ✅ / 🔑 | Cron runs once deployed. All links start as "Not yet checked". |
| **Budgets, meetings, votes** | Governing bodies, officials, meetings (a source is required), motions and votes (a source is required, voters validated), budgets plus line items, FY comparison, audited and unaudited financial reports, vote tallies per official | ✅ | **No civic data is seeded.** Entries must come from minutes, video or official documents. |
| | Transcript/minutes parsing | ⬜ | Manual entry only. |
| **Access** | Free access; payments off; entitlements kept separate from roles (`entitlements` table, `payments: false`) | ✅ | |
| **Security** | CSP and security headers (`public/_headers` plus API headers), CSRF, Origin checks, SameSite cookies, XSS-safe DOM builder (no `innerHTML`), parameterized SQL, audit log | ✅ | |
| **Legacy migration** | Read-only inventory, hash manifest, reconciliation tools, admin import ledger | ✅ | Tested on synthetic fixtures. |
| | Actual export, import and reconciliation of the legacy archive | ⬜ | No access. See [MIGRATION.md](MIGRATION.md). |
| **Infrastructure** | dev, staging and production configs in `wrangler.jsonc` | 🔑 | Staging and production D1 IDs are placeholders. |
| | Deployment | ⬜ | **Not deployed anywhere.** |

## External setup required (owner's Cloudflare and Google accounts)

1. **Check names first.** Make sure the new resource names do not collide with any legacy resource:
   - Workers: `1776-forge-staging`, `1776-forge`
   - D1: `forge-db-staging`, `forge-db`
   - R2: `forge-documents-staging`, `forge-documents`

   If any name exists, rename it in `wrangler.jsonc`. **Never reuse a legacy binding.**
2. **Create new resources:**

   ```bash
   npx wrangler d1 create forge-db-staging
   ```

   ```bash
   npx wrangler d1 create forge-db
   ```

   ```bash
   npx wrangler r2 bucket create forge-documents-staging
   ```

   ```bash
   npx wrangler r2 bucket create forge-documents
   ```

   Paste the returned D1 IDs into `wrangler.jsonc` (`env.staging`, `env.production`).
3. **Apply migrations** to the new databases:

   ```bash
   npm run db:migrate:staging
   ```

   Then repeat with `db:migrate:production`.
4. **Set up the Google OAuth client.** Create it in Google Cloud Console (type "Web application"). Add these authorized redirect URIs:
   - `https://<staging-domain>/api/auth/google/callback`
   - `https://<production-domain>/api/auth/google/callback`
   - `http://localhost:8787/api/auth/google/callback` (for dev)
5. **Set secrets** for each environment:

   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID --env staging
   ```

   Repeat for `GOOGLE_CLIENT_SECRET`, and optionally `TURNSTILE_SECRET_KEY`. Set `TURNSTILE_SITE_KEY` and `OWNER_EMAILS` (the owner's Google email) as vars or secrets.
6. **Domain:** attach a staging hostname, for example `staging.<new-domain>`, as a custom domain on `1776-forge-staging`. Do not move the legacy DNS records.
7. **Turnstile (optional):** create a widget for the staging and production hostnames.
8. **Legacy archive access:** provide the read-only export permissions listed in [MIGRATION.md](MIGRATION.md).
9. **Deploy staging:**

   ```bash
   npm run deploy:staging
   ```

   Verify sign-in, upload, map and forum on staging before production.

## Known gaps and next steps (priority order)

1. Run the legacy export and reconciliation once access is granted, then write the schema-specific import (MIGRATION.md §5).
2. Add sourced GIS layers for Baldwin County and Milledgeville roads, and sourced meeting, vote and budget data.
3. Import verified constitutional text with its source, and add case law with official citations.
4. Add email notifications, FTS5 search, an on-map drawing tool, and UI for jurisdictions and agencies.
5. Run an automated accessibility audit (axe) and browser end-to-end tests in CI.
