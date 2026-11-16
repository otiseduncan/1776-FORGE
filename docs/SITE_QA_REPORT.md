# 1776 FORGE site QA and repair

Audit date: November 15, 2026 (America/New_York). Branch: `fix/site-quality-audit`.

## Scope and source reconciliation

The requested release destination is **https://1776-forge.otiseduncan.workers.dev**. Although the owner calls this staging, the existing Wrangler configuration names this destination `env.production`. The separate `1776-forge-staging` Worker is a different destination and is not substituted for the requested URL.

The main checkout remains the older starter at `96477dc`. Repairs resume in an isolated worktree based on Claude's editorial branch, `0c3ee416aeee69c51c3846724dbeee808fdd77bc`. Fetching origin and inspecting Claude's worktree found no newer commits or uncommitted changes there. No branch is reset or force-pushed.

Before repair deployment, Cloudflare reported active Worker version `76c9bab6-a57d-45a6-8cf7-33f0c13adb94`. All **45 publicly served tracked assets** matched the editorial base commit (text line endings normalized). This establishes the deployed frontend source. The previous deployment did not record a Git commit tag, so its server-side Git SHA cannot independently be certified from deployment metadata. Worker source is unchanged by these repairs.

Verified release bindings:

| Item | Authorized resource |
|---|---|
| Worker | `1776-forge` |
| D1 | `forge-db`, `70520726-5e87-48e1-bf77-1b092bce0d59` |
| R2 | `forge-documents` |
| URL | `https://1776-forge.otiseduncan.workers.dev` |

No legacy Baldwin Minute Watch Worker, database, bucket, DNS or source checkout is modified. No remote migrations or editorial writes are performed. Test users, civic entries and discussions exist only in the isolated local development database.

## Defects corrected

| Defect | Evidence and correction |
|---|---|
| Featured investigation panel covers the headline and summary | Reproduced with the actual Keim article on both `/` and `/news`. At 1440px, media and text bounding boxes overlapped by approximately 62,006 square pixels. `height:100%` plus `aspect-ratio:16/9` transferred the text row height into an oversized media width. Media now sizes within its grid track; image sizing is decoupled from intrinsic content; both columns shrink and long text wraps. No article text is shortened. |
| Anonymous narrow header overflows | Original 320px layout exceeded the viewport by 21px. Compact brand spacing and nonshrinking controls keep search, membership and menu controls accessible. |
| Signed-in header crowds navigation | The newsroom shortcut and avatar did not share a stable flex row. Signed-in overflow measured 134px at 1440px and 21px at 1280px. The header gets an appropriate maximum width and switches to its existing navigation drawer at 1480px. On small screens the duplicate desk shortcut yields to the same destination in the account menu. |
| Nested discussion replies overflow | Six-level local fixtures exposed narrow reply/action rows: 75px page overflow at 320px and 20px at 375px when signed in. Reply grids can shrink, action buttons wrap, and mobile indentation is bounded while all replies remain visible. |
| Article editor file chooser widens the page | A native file input created 54px of page overflow at 320px. Form grid children can now shrink and file inputs respect their available width. |
| Markdown preview can freeze | Unsupported external or malformed image Markdown matched a block-start rule but was never consumed. The parser now advances and displays unsupported syntax safely as text. An editor regression verifies subsequent headings and long text still render. |
| Mobile menu retains the wrong accessible label | After navigation closed the drawer, its button could still be named “Close menu.” Closing now resets both the expanded state and “Open menu” label. |

Navy, red, gold, constitutional artwork, editorial typography and existing article attribution remain in place. No blanket horizontal-overflow hiding was added. Tables and navigation strips retain intentional local scrolling.

## Coverage

Public browser tests discover published content from the API and inspect:

- Homepage; newsroom; real filtered and empty newsroom results; series index and available series pages.
- All four published imported articles, authors, citations, related-record links, headings, paragraphs, tables and supporting video containers.
- Records index, empty results and all seven record detail/PDF-viewer pages; original PDF responses and hashes.
- Map, zoom controls, live OpenStreetMap tile loading and empty verified-layer state.
- Meetings and budgets index; local disposable governing-body, official, meeting and budget detail pages.
- Constitution & Law index and **all 41 legal detail pages**; resource directory and its court filter.
- Forum, discussion form, moderation log, local discussion and six nested replies; jurisdictions and jurisdiction detail.
- Search results and empty results; sign-in, account, notifications, standards, missing-record/article and unknown-route states.
- Signed-out workspace/admin restrictions.

Authenticated local browser tests use a disposable owner session in the normal server-side session table and cover account/member navigation, record submission form, discussion form/thread, contributor overview, article listing, records/map/civic workspace tabs, new article editor, all four imported article editors, live Markdown preview, media-library modal, and administration overview/moderation/users/audit/imports pages. They do not insert authentication shortcuts into the deployed application.

Existing integration tests exercise actual Worker routes with SQLite/R2 fixtures, including OIDC/PKCE/state/nonce/signature validation, CSRF and role checks, draft/review/publish/unpublish, record upload and immutability, forum posts/replies and moderation, map reports, budgets and source requirements.

## Responsive results

| Width | Public pages | Local authenticated workspace | Featured layout |
|---|---|---|---|
| 1920 | Pass | Pass | No overlap or clipping |
| 1440 | Pass | Pass | No overlap or clipping |
| 1280 | Pass | Pass | No overlap or clipping |
| 1024 | Pass | Pass | No overlap or clipping |
| 768 | Pass | Pass | Stacked, readable |
| 430 | Pass | Pass | Stacked, readable |
| 375 | Pass | Pass | Stacked, readable |
| 320 | Pass | Pass | Stacked, readable |

Stress tests cover both light/dark schemes, one/four featured stories, long real headlines extended with unbroken tokens, long summaries and series names, and image/no-image leads: **64 combinations**. Assertions inspect card intersections, card-boundary containment, major text overflow and document horizontal width. Before/after screenshots were saved separately from Git.

## Imported-content integrity

Four public manuscripts were read from the deployed API without changing them:

| Article | Body characters | Citation entries | Attached originals |
|---|---:|---:|---:|
| Harry Keim Dismissed: Systemwide Failure or One Man Blamed? | 6,979 | 9 | 7 |
| Baldwin County Budget Work Session — November 13, 2026 | 2,903 | 1 | 0 |
| Follow the Money: Baldwin County's Hospital Fund and the Missing Financial Audits | 22,019 | 0 | 0 |
| Putnam County: Bring the Original Records into the Data-Center Discussion | 2,306 | 6 | 0 |

Independent browser assertions compare rendered word order to each full Markdown body, with formatting syntax removed, and compare heading/citation/document counts. Read-only live integrity checks compare titles, categories, body, deck, excerpt, byline, authors, publication/update dates, citations and source links with the pre-repair snapshot. All seven original PDF downloads match their recorded SHA-256 fingerprints.

Category presentation is checked against stored metadata; this audit does not certify investigative claims or recategorize reporting. The hospital article has source links in its body but no separate citation-table entries. No associated cover images are present on these four articles; image handling is tested with isolated browser response fixtures.

## Checks and repeatability

- `npm run verify`: TypeScript check, all 25 frontend syntax checks, **64/64 integration tests pass**.
- `npm run test:browser`: **19/19 browser tests pass**, including all eight widths and imported-text integrity.
- `wrangler deploy --env production --dry-run --outdir dist/qa-worker`: Worker bundle and assets build successfully; target bindings reviewed.
- `git diff --check`: pass.
- Dependency installation audit: zero vulnerabilities reported.

To repeat local QA, use Node 22.18 or newer and separate terminals for the server and checks:

```powershell
npm ci
npx playwright install chromium
npx wrangler d1 migrations apply DB --local --persist-to .wrangler/qa-state
npx wrangler dev --ip 127.0.0.1 --port 8798 --persist-to .wrangler/qa-state
```

With the local server running:

```powershell
npm run qa:snapshot
npm run qa:seed
npm run verify
npm run test:browser
node scripts/qa-screenshots.mjs
```

The seed script refuses command-line arguments and hard-codes local Wrangler persistence and loopback HTTP. Its SQL, local session tokens, public snapshots, screenshots and browser traces are ignored under `qa-artifacts/`, `.wrangler/` and `test-results/`. Never publish those fixture files. The snapshot reads current public content, allowing regression tests to follow future imports without committing manuscripts.

To test the deployed URL, with local fixture authentication automatically skipped:

```powershell
$env:QA_BASE_URL = 'https://1776-forge.otiseduncan.workers.dev'
npm run test:browser
node scripts/qa-verify-live.mjs
node scripts/qa-provenance.mjs HEAD
```

## Verification limits and existing data gaps

- Fresh interactive Google consent and real deployed owner write/publish actions were not replayed. Google configuration and anonymous permission boundaries were checked over HTTPS; OIDC and authorized writes pass integration tests. Authenticated visual/form checks are local.
- Live verified GIS data is empty. Base tiles render; no road condition or government facts are invented. Civic detail layouts use clearly labelled local fixtures where live data is absent.
- External agencies, source websites and video providers control their own availability. Their factual contents and every external destination are not certified by this layout audit.
- Browser automation uses Chromium; Safari/Firefox and a full manual screen-reader audit were not performed.
- The original import manuscripts are not independently compared to private source files. The existing published API content is preserved and its rendered text is checked in full.

No remaining layout failure is observed in the tested cases. These limits are not represented as completed live workflows.

## Release record

Code commit and final Cloudflare version are recorded below after deployment and live verification. Deployment is authorized only for the requested FORGE URL; the separate staging Worker and all legacy services remain unchanged.
