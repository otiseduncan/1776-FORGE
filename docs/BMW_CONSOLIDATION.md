# Baldwin Minute Watch consolidation — staging handoff

Prepared November 20, 2026 (America/New_York).

Public organization: **Baldwin Minute Watch**. Research system: **The Forge**.
Motto: **Debate the Issue. Bring the Documents.**

## Release state

The replacement is deployed for review at https://1776-forge-staging.otiseduncan.workers.dev.
The read-only original-map rehearsal is at https://bmw-legacy-consolidation-preview.otiseduncan.workers.dev/#/map.
Production has NOT switched. None of the three existing production Workers was redeployed, retired or redirected. No production database was migrated, reset, overwritten or deleted.

The source starts from `6c14eac`, identified by the live FORGE deployment's annotation, and is on branch `codex/bmw-consolidation`. This includes the previously published newsroom and its existing covers. The migration brief authorizes a future change to the old website target, superseding the repository's historical blanket prohibition only after the user's final deployment authorization. Until then, production remains read-only.

## What changed

- Header, footer, navigation, homepage, login, client titles, crawler metadata and default newsroom bylines use Baldwin Minute Watch. Historical article text, credits, provenance, record titles and identifiers remain unchanged.
- The Forge is the public research interface at `/records`, with `/forge` as an additional entry point.
- The front page leads with the existing published investigations, then recent reporting, Meeting Watch, records search, maps, community and mission.
- `/about` explains the relationship between the public newsroom and The Forge. `/government` is labelled Meeting Watch.
- Reused the eagle-and-flag asset already supplied by the owner in the legacy repository (`public/assets/brand/header.webp`), copied byte-for-byte as `bmw-eagle-flag.webp`. No replacement artwork was generated.
- Kept publishing, permissions, moderation, records, maps, legal research, regional research, standards, corrections and admin components. No schema changes were required.
- Added read-only legacy record browsing across 15 archive jurisdictions, original record detail pages, hash-link translation and preserved community discussion pages.
- Kept the original map and its data in a separate read-only rehearsal instead of guessing how to convert its project and road classifications into the new schema. Browser verification showed 127 original published map records.
- Replaced the forum moderation reason's native prompt with an accessible form dialog after live testing exposed a browser compatibility problem. D1 overload now returns a non-cached 503 with Retry-After instead of a generic internal error.
- Staging pages return noindex metadata, and robots.txt disallows indexing.

## Infrastructure discovered

| Component | Production Worker | D1 | Persistent files |
|---|---|---|---|
| Newer newsroom and research platform | `1776-forge` | `forge-db`, `70520726-5e87-48e1-bf77-1b092bce0d59` | `forge-documents` R2 |
| Existing public map/community app | `baldwin-minute-watch-map` | `baldwin-minute-watch-reports`, `f9fdcc24-ad94-4f42-b457-feb28304608c` | `baldwin-minute-watch-photos` R2 and static map assets |
| Legacy evidence service | `baldwin-minute-watch-v21` | No live D1 binding | `bmw-v21-archive` R2; catalogues embedded in Worker source; additional static documents/assets |
| Prior FORGE staging | `1776-forge-staging` | `forge-db-staging`, `5f7bb9b8-117b-45e3-83ae-e37b1008e9af` | `forge-documents-staging` R2 |

The old map uses a `RECORDS` service binding to the independent evidence Worker. That Worker remains in place. The account's KV namespace inventory was empty. The inspected production bindings did not contain Durable Objects or other persistent services.

Production uses Google OIDC with PKCE/state/nonce and host-scoped secure session cookies on FORGE. The older app has a separate member/token/role model. Those identities and roles must not be treated as interchangeable.

### Independent rehearsal resources

| Resource | Name / identifier |
|---|---|
| Main preview Worker | Existing `1776-forge-staging`, updated with preserved secrets |
| Main preview D1 | `bmw-consolidation-preview`, `2094ca37-49d8-4681-9512-6c54de847f09` |
| Main preview R2 | `bmw-consolidation-preview` |
| Legacy preview Worker | `bmw-legacy-consolidation-preview` |
| Legacy preview D1 | `bmw-legacy-preview`, `77a5191b-3c31-44e1-9cc5-c565b4de485b` |
| Legacy preview photo bucket | `bmw-legacy-preview` |

Main preview binds `LEGACY_RECORDS` to the original evidence Worker for GET/HEAD only and `LEGACY_MAP` to the isolated read-only legacy clone. Production credentials/cookies are never forwarded by either compatibility proxy. No write or delete operations are exposed through those proxies.

## Data preservation report

Originals are under the deliverable folder `Preservation_Backup`. Backups include Git bundles for all three local source repositories; working-source ZIPs; the live FORGE source commit archive; raw deployed Worker modules; settings, bindings, secret names and version/deployment inventories; SQL exports; database schemas/counts; remote static assets at source-known paths; original R2 objects and per-object manifests.

Cloudflare does not return plaintext Worker secrets. Their names and configurations were captured; values remain in Cloudflare. The existing local Google client credential file was located without copying it into deliverables or source control. The source ZIPs exclude `.env`, `.dev.vars`, node_modules and local runtime state. Database backups contain private account/audit information and are local preservation files, not website assets.

| Original R2 bucket | Objects backed up | Bytes |
|---|---:|---:|
| forge-documents | 1,405 | 1,774,924,857 |
| forge-documents-staging | 7 | 15,147,781 |
| bmw-v21-archive | 4,891 | 11,222,091,283 |
| baldwin-minute-watch-photos | 1 | 311,785 |
| **Total** | **6,304** | **13,012,475,706** |

Every downloaded object has its original storage key recorded in its manifest and a SHA-256 digest of the local bytes. Backup filenames are hashes of storage keys; use the manifest to resolve original keys. HTTP/custom metadata is retained in the inventory. There were zero missing or mismatching objects against the 5,704 catalogued legacy file references. Multiple catalogue entries can reference the same stored file.

### Database/content inventory

FORGE: 41 application/migration tables; 1,401 documents; 25 articles (4 published, 21 drafts); 1 series; 4 cover media assets; 1 user; 0 production forum discussions/comments; 26 resource links; 41 legal authorities. It has no populated civic meeting/vote/budget or map feature rows in this snapshot. Their working interfaces remain available; the old map's data stays in its own preserved collection.

Legacy map: 35 application/migration tables; 5 members; 5 threads; 1 reply; 3 reports; 1 photo; 3 public-record source entries; 25 source registry entries; 9 county rows; 6 county memberships. Likes, flags, moderation/audit history, regional configuration, points and competition rows are retained in the SQL backup. Public archive views honor the old visibility rules; a backed-up row is not automatically published.

The legacy evidence catalogue has 5,704 stable entry IDs grouped into 4,888 file/jurisdiction cards across 15 jurisdictions. Of those catalogue entries, 1,206 have an exact original-file hash match in FORGE; 4,498 do not. These are file-level comparisons, not claims that the collections have identical metadata, legal significance or completeness. No deduplication or row merging was performed.

The main preview clone matches all 39 non-session source tables, row for row and digest for digest. Production session and OAuth-state rows were intentionally excluded. The cloned R2 bucket has exactly 1,405 matching keys, sizes and ETags. All 1,401 document hashes and four cover hashes match the preserved bytes. Local restore integrity and foreign-key checks passed.

Subsequent live staging sign-in, posting and moderation tests intentionally created staging-only account/session/audit/test rows after the clean-clone reconciliation. These are not production data changes. The test thread is hidden with a public reason; audit history is retained.

### Safe import and identity policy

Retain legacy namespaces and IDs during transition. Do not merge records solely by title, filename or matching bytes; a single file may have different jurisdictional provenance or review decisions. Any later import needs an explicit crosswalk of old ID, new ID, storage key, hash, source, jurisdiction, access state, citations and relationships. Use repeatable inserts with uniqueness constraints and a reconciliation report. An existing target ID must fail or reconcile, never silently overwrite.

Historical members and post attribution remain in the preserved database. A current verified Google identity may later be linked to a historical membership only with a reviewed identity mapping. Do not copy legacy roles, login tokens, notification subscriptions or elevated permissions into the new auth system. The new production FORGE account's stable user ID/role is retained by continuing to use `forge-db`.

## Verification

- TypeScript and frontend syntax checks passed; 67 integration tests passed, including OIDC validation, CSRF, roles, forum posting, moderation, publishing, original-file handling, civic data, legacy hash translation, read-only proxy behavior and capacity-error handling.
- All four existing public investigations load through their unchanged slugs, with existing covers, source lists and evidence limitations retained. Article crawler previews use Baldwin Minute Watch and page-specific canonical URLs.
- All 1,401 public record detail endpoints succeeded, including bounded retries. An initial pass overlapped the isolated staging SQL export and saw 160 temporary errors that recovered. A later scan running alongside the exhaustive legacy scan saw 831 intermittent 500 responses; all recovered at concurrency two. A subsequent 100-request probe at concurrency eight had zero failures. A longer probe reproduced the error; live logs identified `D1 DB is overloaded. Too many resources consumed within a 10 second window.` Capacity saturation now returns 503 with Retry-After: 10 and no-cache. Capacity review remains a launch gate; this is not a clean load-test pass.
- All 5,704 legacy catalogue IDs returned matching metadata IDs and recorded hashes through the compatibility API, with zero failures.
- Five sampled legacy originals were downloaded through compatibility routes and matched their catalogue SHA-256 values. Full stored-file reconciliation covers all original objects independently of these HTTP samples.
- Browser checks covered eight main routes at 1440, 768, 390 and 320 pixels: 32 observations, no horizontal page overflow. Checked homepage, reporting, The Forge, Meeting Watch, community, mission, login and Keim article. Additional browser checks opened legacy records, an old hash link with its PDF page reference, a historical community thread, the preserved map, admin and newsroom workspace.
- Real Google sign-in completed in staging and showed the existing Owner account and stable profile ID. Admin and newsroom workspace opened under that account.
- A staging-only discussion and reply were created, then the discussion was hidden through moderator tools. The public removal reason and moderation log were verified. An anonymous API check confirmed the hidden thread returns the removal notice rather than its body.
- Anonymous publishing/community/admin writes were blocked. Legacy evidence write requests returned 405.
- Before/after deployment inventories confirm all three production version selections are unchanged.

Machine-readable reports, tests and screenshots are included beside this document. These results are functional and preservation checks; they do not certify the factual accuracy or completeness of historical records or article manuscripts.

## URL migration and redirect plan

| Existing link | Replacement behavior |
|---|---|
| `/news/:slug` | Same slug, same production FORGE database and article ID |
| `/records/:id` | Same FORGE document ID |
| `/#/record/:legacyId?p=N` | Browser translates to `/legacy/records/:legacyId#page=N` |
| `/document?id=:legacyId#page=N` | Same legacy reader, original ID and page reference |
| `/civic-api/*` | Read-only proxy to the original evidence Worker `/api/*` |
| `/civic-files/documents/*` and `/documents/*` | Original evidence file path through the preserved records Worker |
| `/api/archive/documents/:id` and `/api/archive/files/:id` | Original archive metadata/file endpoints, with existing publication restrictions |
| `/#/forum/:threadId` | `/legacy/community/:threadId`, original public attribution and status |
| `/api/forum/threads/*` | Read-only legacy compatibility API |
| `/#/map`, `/#/project/*`, `/#/road/*`, `/#/report/*`, `/#/county/*` | `/legacy-map` hands off to the preserved original map with hash/query intact |
| FORGE-hosted old links after transition | Path- and query-preserving redirect to the official hostname; browser retains fragments |

The preserved map origin is configurable with `LEGACY_MAP_ORIGIN`; the rehearsal uses the clone's preview hostname. Set a stable archive origin when promoting it. Do not point this service binding back at `baldwin-minute-watch-map` after that Worker becomes the new app: that would create a loop.

Important remaining compatibility boundary: old and new applications both use `/api/records` with different response schemas. The candidate keeps the new API at this route and exposes the old submission API at `/legacy-api/records`. Browser document links are handled explicitly. Before retiring old clients, inventory any non-browser consumers that call the old API directly; provide a versioned client migration instead of claiming both incompatible list schemas can occupy one endpoint. Old email report tracking/verification and old magic-link login are not migrated into the new OIDC flow. Keep the original snapshot and decide an explicit handling policy for outstanding links before switching.

## Production readiness checklist

Completed:

- [x] Existing source, deployed code/configuration, D1 and R2 originals backed up.
- [x] Published newsroom and source references preserved.
- [x] Newer platform rebranded and mobile/desktop staging reviewed.
- [x] Stable FORGE IDs and legacy record/PDF deep-link compatibility implemented.
- [x] Legacy records, historical community and original map accessible in rehearsal.
- [x] Separate staging database/file storage and original-file hash reconciliation.
- [x] Real staging Google login, Owner access, posting, reply and moderation verified.
- [x] Existing production version IDs captured and confirmed unchanged.
- [x] Rollback procedure recorded.

Required before production cutover:

- [ ] Owner reviews the staging preview and authorizes the final production deployment.
- [ ] Review D1 capacity and anticipated traffic against the reproduced rapid-scan saturation; use a controlled load test and a deliberate caching/capacity plan if needed. Do not describe retry recovery or the smaller successful probe as proof of production load readiness.
- [ ] Resolve the direct old `/api/records` consumer and outstanding report/email-link boundary described above. This is a launch gate, not a missing backup.
- [ ] Register and verify `https://baldwin-minute-watch-map.otiseduncan.workers.dev/api/auth/google/callback` on the existing Google OAuth client. Keep both existing FORGE/staging callback URLs during transition. The supplied local credential file lists staging; that file alone is not proof of the live OAuth console's current redirect allowlist.
- [ ] Install Google client ID/secret and owner allowlist securely on the official Worker at deployment time; secret values are not copied into Git or this report. Existing Cloudflare secrets must be retained. Confirm Turnstile/origin settings against the official host.
- [ ] Refresh all backup/inventory snapshots and the read-only historical clone to a recorded cutover timestamp; account for writes made since this rehearsal. Use a brief controlled write freeze or equivalent change capture for legacy community/report submissions.
- [ ] Promote the archive clone to an intentional stable service/origin, update its home link to the official site and set `LEGACY_MAP_ORIGIN` and `LEGACY_MAP` accordingly. Retain its isolated historical data and read-only restrictions.
- [ ] Confirm the official Worker config binds `DB` to **forge-db** and `DOCS` to **forge-documents**, never the old map database. Leave the old database/bucket intact for compatibility and rollback.
- [ ] Re-run verification and dry-run the final config; no remote database migrations or imports are necessary for the existing FORGE content.
- [ ] After authorized switch, test official-host Google login, role checks, posting/moderation, all four investigations, evidence files, key legacy URLs and social metadata. Official-host auth cannot be certified before that hostname serves the replacement.
- [ ] Only after official-host validation and owner acceptance, begin the temporary FORGE URL redirect. Keep the FORGE URL live and unchanged until then.

No launch gate should be cleared merely because an automated test passed on a different hostname.

## Authorized cutover procedure (not executed)

1. Obtain the owner's final deployment authorization after the launch gates above have concrete resolutions. Capture the current official Worker and FORGE deployment versions again.
2. Securely set Google OIDC/owner secrets on the official Worker, preserving existing secrets/vars. Add the official Google callback and verify its allowlist. Do not paste secrets into command arguments, logs, output files or repository config.
3. Prepare `wrangler.official.json` from the supplied non-deployable `wrangler.official.json.template`, substitute the stable archive service and origin, retain existing settings that remain applicable, and run `npm run verify` and `wrangler deploy --config wrangler.official.json --dry-run`.
4. Deploy the reviewed replacement to **baldwin-minute-watch-map**, with production `forge-db`/`forge-documents` bindings and `--keep-vars`. Keep `1776-forge`, the records Worker, the legacy database and every original bucket intact. Do not run old-app SQL migrations against FORGE or vice versa.
5. Run official-host smoke, auth, permissions, community, archive and crawler tests. Record the new version ID. If any required check fails, execute rollback immediately.
6. Keep the original FORGE hostname available during a documented observation window. A later, separately reviewed redirect Worker must preserve each path and query; never redirect all evidence links to `/`. API clients using host-scoped sessions must sign in at the official hostname; do not forward session cookies across hosts.

## Rollback

Recorded baseline versions:

| Worker | Baseline version |
|---|---|
| baldwin-minute-watch-map | `1b8716b4-4f26-43e7-89fc-426b1be44380` |
| 1776-forge | `451ba542-4baf-44e4-b2d5-816f7ac81525` |
| baldwin-minute-watch-v21 | `8bda4e3e-c6a5-4219-83b7-ca44861dbadf` |
| Previous FORGE staging, before this task | `aab31f74-30fd-428e-8667-ac658b75a781` |

For an official-host failure, use Wrangler rollback on `baldwin-minute-watch-map` to the freshly re-captured baseline version. At this snapshot the explicit command is:

```text
wrangler rollback 1b8716b4-4f26-43e7-89fc-426b1be44380 --name baldwin-minute-watch-map --message "Rollback Baldwin Minute Watch consolidation"
```

Confirm that its old DB, PHOTOS, RECORDS and origin bindings match the captured settings, and that its public map, archived documents, forum and report endpoints load. Do not restore SQL over a production database as part of a code rollback. Keeping the old database and files intact makes code rollback independent of a destructive data restore.

If new-site writes occurred after cutover, preserve them in `forge-db`; do not delete or replay them into the legacy schema. FORGE remains directly accessible during this rollback window. If a redirect was later enabled on the FORGE hostname, roll that Worker back to its captured application version as well.

For staging-only rollback, restore the prior `1776-forge-staging` version and confirm its original `forge-db-staging` and `forge-documents-staging` bindings. The new preview resources can remain for analysis; do not delete them as part of a rollback.
