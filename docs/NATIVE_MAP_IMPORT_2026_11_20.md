# Native project map deployment — November 20, 2026

Live map: https://baldwinminutewatch.org/map
Production Worker version: f8591841-46f5-46eb-9fdd-9b7ef81981cc
Application source: 2f3a1ff
Previous production version: d9e575bd-1768-4b97-9eda-9060d0a5e357

## Delivered

The native live map now includes all 127 published road/project records (117 projects and 10 road records) from the preserved collection, covering 33 counties. It no longer requires visiting the separate legacy map to see those projects. The read-only imported catalogue is merged with native D1 map features at the public feature API and in main site search. New native entries retain their existing permission-controlled creation and moderation flows.

All 49 saved locations have icons; saved road geometry is retained. Hover summaries show the project, county, description, the applicable exact financial figure and its original measure, and recorded contractor. Clicks open full costs, funding, authorization, contractor, source references, financial notes and evidence gaps. Nearby overlapping markers offer a chooser rather than moving coordinates. Search accepts project and road names, contractors, counties, exact amounts and original financial notes. County filters, layer toggles, result pagination and mobile interactions are available.

The 78 records without saved site geometry remain searchable in the directory. Distinct gold county-directory buttons represent county navigation, not invented project locations. Shared multi-county projects remain single records and retain financial labels for their shared totals. Contract amounts, approved allocations, estimates, invoices and payments were not combined or reclassified as paid expenditures. Original financial notes, including bond-authorization limitations, remain visible.

## Preservation and reconciliation

Eight map input files and 42 published source-text files were copied without changing their bytes. Each was compared to the original baldwin-minute-watch-map Worker and to the preserved source clone. The 50 files were also fetched from the new live site after deployment: zero missing files or SHA-256 mismatches. Git attributes disable newline conversion for these immutable inputs; their staged repository bytes were independently hash-checked.

The public feature response contains all 127 original keys with no missing or duplicate IDs. Its titles, financial metadata and county assignments match the old normalizer's published collection for every record. Original raw source fields are retained as well, so free-text cost and qualification notes are not lost when they lack structured amounts.

No legacy Worker, original source file, D1 row, bucket object, DNS setting or historic account permission was modified. This integration uses an independently preserved read-only source snapshot, not a destructive database migration. It does not duplicate original PDF files: the original document URLs remain cited; 42 already-published extracted source-text files are included locally and labelled as automated extraction requiring source review.

## Verification

- TypeScript/frontend checks and all 75 integration tests passed.
- Staging and production browser checks verified 127 loaded records, 49 icons, overlapping-marker selection, exact contract/contractor hover summaries, detailed source panels, contractor search, county filtering, unlocated-record handling, source-text dialogs and main-site map search.
- Production map/detail layouts passed at 320, 375, 430, 768, 1024, 1440 and 1920 pixels without horizontal page overflow or browser script errors. Selected screenshots were visually reviewed.
- Existing Meeting Watch, packet download/hash, embedded PDF page, archive search/filter and mobile navigation interaction checks passed again after the map release.
- These are migration and functionality checks, not a fresh audit of every historical project, contractor or payment. Existing verification limits, approximate geometry notes and missing locations remain explicit.

## Maintenance and rollback

The importer is scripts/import-published-map.mjs. Pass the preserved public directory explicitly and an optional original public origin to verify live hashes. It preserves source identities and refuses an unreviewed change to the 127-record catalogue size. The normalizer source hash, source manifests and regression tests document the transformation.

Newly recorded site locations for the 78 unlocated entries require actual location evidence; this release does not assign guessed work sites. The preserved project collection is a reviewed import snapshot, not an automatic mirror of future legacy edits.

To revert this code release while retaining database and stored documents:

    npx wrangler rollback d9e575bd-1768-4b97-9eda-9060d0a5e357 --config wrangler.production.json --message "Revert native map import"

The preceding version has an empty native project view; do not restore a staging database over production.
