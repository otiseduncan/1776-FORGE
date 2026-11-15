# Implementation status

Last updated 2026-11-15 on branch `claude/1776-forge-audit-architecture-4270ca`.

## Deployed staging environment

**Live URL:** https://1776-forge-staging.otiseduncan.workers.dev

| Item | Value | Status |
|---|---|---|
| Worker | `1776-forge-staging` on workers.dev; weekly link-check cron `0 6 * * 1`; observability logs on (100% sampling) | ✅ deployed, HTTPS verified |
| D1 | `forge-db-staging` (`5f7bb9b8-117b-45e3-83ae-e37b1008e9af`) | ✅ new; 5 migrations applied (0005 editorial on 2026-11-15); 38 original tables plus `article_series` and `media_assets`, 26 resources, 41 legal authorities, 4 jurisdictions, 6 forum categories |
| R2 | `forge-documents-staging` | ✅ new. The disposable test object was deleted. It now holds 7 original PDFs for the Keim story (imported 2026-11-15); each one downloads byte-identical, with a matching SHA-256. |
| Google OAuth | Dedicated Google Cloud project `forge-1776-app`, web client "1776 FORGE" with redirect `…/api/auth/google/callback` | ✅ `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set as Worker secrets. A real Google sign-in was verified. The consent screen is in **Testing** mode with one test user (the owner). Public sign-in needs the app published, and possibly Google verification. |
| Owner bootstrap | `OWNER_EMAILS` Worker secret | ✅ set; the owner signed in and received the Owner role (18 capabilities) |
| Turnstile | — | not configured (optional) |
| Production | `1776-forge` / `forge-db` / `forge-documents` | ⬜ not created, not deployed |

### Pre-existing Cloudflare resources (inventoried read-only, untouched)

- **Workers:**
  - `baldwin-minute-watch-community-preview`
  - `baldwin-minute-watch-jones-preview`
  - `baldwin-minute-watch-map`
  - `baldwin-minute-watch-map-staging`
  - `baldwin-minute-watch-v21`
- **D1:**
  - `baldwin-minute-watch-community-preview`
  - `baldwin-minute-watch-reports-staging`
  - `baldwin-minute-watch-reports`
- **R2:** `baldwin-minute-watch-photos`, `bmw-v21-archive`.
- **Zones and custom domains:** none on the account.

No command was run against any of these. FORGE uses only the new resources listed above.

### Staging verification (live HTTPS, real browser)

| Check | Result |
|---|---|
| Homepage, approved banner and emblem artwork; 10 homepage sections; homepage map preview tiles | ✅ |
| All header and footer navigation links (25 routes), SPA 404 page, missing-record 404 | ✅ No render errors, no overflow, no CSP violations |
| Map: 12/12 tiles loaded, zoom control, layer toggles, sign-in prompt on "Report a problem" | ✅ |
| Constitution: 28 amendment tiles, Bill of Rights page links to archives.gov, XVIII shown as repealed | ✅ |
| Resources: 26 entries, text filter ("court" → 6), level filter (state → 9), external links use https + `noopener` | ✅ |
| Search ("Fourteenth" → Fourteenth Amendment), records search empty state, forum reading with categories | ✅ |
| Mobile (375 px): no overflow on 13 routes, menu drawer, map tiles | ✅ |
| API: JSON 200s, JSON 404 for unknown API, 422 on short search, 401 on unauthenticated write, CSP/nosniff/DENY/Referrer/Permissions headers | ✅ |
| Google sign-in (PKCE, state, nonce), owner role, HttpOnly `__Host-` cookie not readable by JS | ✅ |
| Forum: new discussion, top-level and nested replies, edit ("edited" shown), auto-follow, anonymous read without reply rights, POST without CSRF header → 403 | ✅ |
| Newsroom: draft → publish in the UI, shown in public `/api/news` and rendered, then archived | ✅ |
| Records: created in the workspace; PDF uploaded through the Worker to R2; stored SHA-256 matches; download byte-identical; `x-forge-sha256` header matches; integrity check "ok"; inline PDF preview | ✅ |
| Civic: governing body, official with source, meeting with video, motion with a recorded vote, FY budget with CSV line items and totals | ✅ |
| Admin: overview, moderation queue, map report pending → rejected with note → author notified, discussion removed with public reason → moderation log, users, audit log, imports page (no legacy data) | ✅ |
| Defects found and fixed on staging | (1) Signed-out Account, Notifications, Workspace and Admin pages had no `<h1>` (fixed in `2d04b17b`). (2) A removed discussion did not show its public reason to moderators or the author, and moderators had no "Restore" button (fixed in `8cbcc944`, with a regression test). |
| Test-data cleanup | All staging test records, civic entries, the map report and the stored PDF were deleted by ID. The R2 bucket is empty. The archived test article and the removed test discussion are not public. The 19 audit events were kept. |

Local test sessions (`scripts/dev-session.mjs`) write only to the local `.wrangler` database and refuse `--remote`. Staging has no test users or development sessions. The only account is the owner's real Google sign-in. The current deployed version is `f83d4ab3` (editorial publishing system). Staging holds 25 legacy inventory entries (4 imported manuscripts and 21 placeholders), all nonpublic drafts. See [EDITORIAL.md](EDITORIAL.md).

## How this was verified

- `npm run check` passes: the TypeScript Worker type-checks and all 25 frontend modules pass a syntax check.
- `npm test` passes: 64 integration tests (auth/OIDC, records, community, newsroom, editorial publishing and legacy import, map, law, civic, admin, links, legacy tooling). They run against the real Worker router, a D1-compatible SQLite shim and an in-memory R2.
- Browser checks ran on local `wrangler dev` with a local D1 at 1280 px, 768 px (tablet, dark mode) and 375 px (mobile). They covered every route in the route table:
  - no horizontal page overflow and no render errors;
  - no CSP violations;
  - map tiles fully loaded on desktop and mobile;
  - signed-in flows exercised through the UI: start a discussion, reply, nested reply, draft an article with live preview, workflow buttons, create a governing body and a meeting, and the source-required rejection.
- **Not verified:** legacy archive migration (not in scope for staging), production resources, sign-in by Google accounts other than the listed test user.

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
| **Google SSO** | OIDC with PKCE, state, nonce, ID-token signature and claims verification, hashed sessions, CSRF, logout, revoke all, account deletion | ✅ (tests + staging) | Live on staging in Testing mode. Publish the consent screen for public sign-in. |
| | Roles: member, contributor, researcher, editor, admin, owner, plus server-side capabilities; owner bootstrap via `OWNER_EMAILS` | ✅ | No hardcoded admin. Role changes need a reason and are audited. |
| **Newsroom** | Drafts, submit, second-editor review and publish, return with notes, unpublish, featured, archive. Seven story types; categories, tags, keywords and jurisdictions. Series and investigation pages, cover images (R2, SHA-256, required alt text, illustration label), attached source documents, citations with source checks, related stories, corrections, version history, original-publication attribution, manuscript-status guards. Search and filters, reading time, Open Graph/canonical/JSON-LD and sitemap. | ✅ | See [EDITORIAL.md](EDITORIAL.md). Imported stories are drafts awaiting owner review. |
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
| **Infrastructure** | dev, staging and production configs in `wrangler.jsonc` | ✅ staging / 🔑 production | The staging D1 ID is set. The production ID is still a placeholder. |
| | Deployment | ✅ staging / ⬜ production | Staging is live at https://1776-forge-staging.otiseduncan.workers.dev. Production has not been created. |

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
