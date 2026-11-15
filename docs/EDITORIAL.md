# Editorial publishing system and legacy reporting inventory

Last updated 2026-11-15.

This document covers four things:
- how the 1776 FORGE newsroom works;
- how original Baldwin Minute Watch reporting was inventoried and imported;
- what is still missing;
- how to roll the migration back.

## What was already here (Phase 1 audit)

The newsroom was not a separate blog. It already existed inside the Worker (`src/routes/news.ts`) and the SPA (`public/js/pages/news.js`, `workspace.js`). It already had:
- drafts, submit-for-review and second-editor publishing;
- return-with-notes, featured stories and archiving;
- categories, tags and video embeds;
- citations, links to records, corrections, version history, author pages and discussions.

This work extends that system. Nothing was replaced. The records library, map, meetings and votes, forum and Google sign-in are unchanged, and their tests still pass.

## Data model (migration `0005_editorial.sql`)

The migration is additive only: it adds nullable columns and new tables. No existing row is changed or duplicated.

| Need | Where |
|---|---|
| Stable UUID and slug | `articles.id`, `articles.slug`. The slug is unique and locked once a story has been published. |
| Headline, deck, excerpt, body | `title`, `summary` (the deck), `excerpt`, `body` (safe Markdown: headings, lists, quotes, tables, rules, links, media-library images) |
| Story type | `kind`: investigation, report (Reporting), commentary (Opinion), explainer (Education), community, personal_essay, update |
| Byline, original publisher and date, updated date | `byline`, `original_publisher`, `original_published_at`, `original_headline`, `original_url`, `published_at`, `updated_at` |
| Jurisdiction, topics, tags, keywords | `jurisdiction_id`, `category_id`, `article_tags`, `keywords` |
| Hero image and alt text | `hero_media_id` points to `media_assets`, which holds the R2 key, SHA-256, alt text, caption, credit and `is_illustration` |
| Attached records, citations, media | `content_links` (article → document, relationship `evidence`), `citations` (+ `verified_at`/`verified_by`), `video_url` |
| Series and installments | `article_series` (series or investigation, draft/published), `series_id`, `series_order` |
| Workflow states | `status`: draft, review, published, archived. Unpublish returns a story to draft. |
| Corrections and change log | `article_corrections` (public); `article_versions` + `audit_events` (internal, every edit has a version) |
| Manuscript provenance | `manuscript_state` (original, imported, needs_manuscript, needs_evidence), `provenance_note`, `legacy_ref` (unique) |

## Public reading experience

- **`/news` — the newsroom:**
  - search across headline, deck, excerpt, body and keywords;
  - topic chips, story-type chips, a place filter and newest/oldest sorting;
  - a lead story, and cards showing cover art, type, series, byline, date and reading time.
- **`/news/series` and `/news/series/:slug`:** investigation and series landing pages, listing installments in order.
- **`/news/:slug` — the article page:**
  - deck, byline, published and updated dates, and reading time;
  - the cover image with caption and credit; illustrations are labelled "Illustration";
  - a publication-history note crediting the original publisher;
  - corrections;
  - the body;
  - the embedded supporting video;
  - **Source documents**: the attached records, with type, date, verification state and SHA-256;
  - **Sources & citations**, with a "Source checked" badge;
  - tags, a series sidebar, related records, discussion and related stories.
- **Who can read what:**
  - Reading never requires sign-in.
  - Drafts, placeholders and unpublished stories return 404 to readers.
  - Unpublished cover images return 404 to readers.
- **Search, sharing and indexing:**
  - The Worker serves `/news/*` with story-specific `<title>`, description, canonical URL, Open Graph/Twitter tags and NewsArticle JSON-LD.
  - Unpublished URLs get `noindex`.
  - `/sitemap.xml` lists published stories and series.
  - `/robots.txt` blocks indexing everywhere except production.

## Editorial dashboard (`/workspace/articles`)

Editing is limited to signed-in contributors and editors, using the existing Google sign-in and roles. There is no public write access.

The editor has these sections:
- **Story:**
  - headline, deck and excerpt;
  - a Markdown body with live preview and word count/reading time;
  - a "Preview as reader" link.
- **Classification:** type, category, jurisdiction, series and installment number, tags and search keywords.
- **Byline & publication history:**
  - byline, video, original publisher, date, URL and headline;
  - the provenance note and manuscript status (editors only).
- **Search & sharing:** search/share headline and description, and the slug (locked after first publication).
- **Cover image:**
  - upload a JPEG, PNG or WebP (up to 15 MB) with required alt text, caption, credit and an "illustration" flag;
  - or pick one from the media library.
  - Files are stored unchanged in R2, deduplicated by SHA-256.
- **Source documents:** search the records library and attach or detach records.
- **Sources & citations:** add sources (title, https URL, pinpoint, note). Editors mark each one "checked" after opening it.
- **Related stories:** link or unlink other stories.
- **Workflow:**
  - submit, publish, return to author, unpublish (reason required), feature and archive;
  - corrections are appended from the public page.
- **Version history:** every saved version.

Guards:
- A `needs_manuscript` placeholder cannot be published.
- A `needs_evidence` story can only be published after the editor ticks "I reviewed the flagged evidence gaps".
- Editing a published story requires a change note.
- Contributors cannot set the manuscript status.
- Only editors can mark sources checked or manage series.

## Legacy content inventory (Phase 5)

### Where the search looked

- **The owner's local research folders.** This included the Baldwin Minute Watch project folders, the research archive for November 4–15, the property-tax investigation evidence packs and the November 6 report folder.
- **The connected Google Drive.** It was searched for every lead title and key phrase. Drive held no essays or story manuscripts. It does hold confidential case files for a private individual; they are outside this inventory and were not imported.

### How the import works

`scripts/editorial/legacy-inventory.json` lists each lead. For each one it records the decision, the manuscript or document path relative to the source folder, and the SHA-256. The repository is public, so manuscripts and PDFs are never committed.

`scripts/editorial/import-legacy.mjs`:
- refuses to import any file whose hash does not match;
- creates every story as a **nonpublic draft**;
- records each formatting edit in `provenance_note`;
- uses stable IDs with `INSERT OR IGNORE`, so re-running it never duplicates or overwrites anything.

### Results

Run on local and on staging, 2026-11-15:

| # | Lead | Result | Notes |
|---|---|---|---|
| 1 | Harry Keim removal and board accountability | **Imported — draft, needs evidence** | See [the first feature story](#first-feature-story) below. |
| 2 | Missing audits and state funding | Placeholder — needs manuscript | The "Day Six — Audit Gap" research pack exists (a video research pack, not an article). The hospital manuscript also discusses missing audits. |
| 3 | Budget and spending | **Imported — draft, needs evidence** | The Nov 13, 2026 budget work-session summary (an unposted draft). It is based on a machine transcript, so figures need direct audio review. |
| 4 | Tax anticipation notes / $15M borrowing | Placeholder | TAN research outputs exist; no manuscript. |
| 5 | 3.5-mill property tax increase | Placeholder | Nothing found. |
| 6 | Hospital fund investigation | **Imported — draft, needs evidence** | The Nov 10 publication draft, "Follow the Money". Its sources still link to the legacy archive; those originals are not yet in FORGE. |
| 7 | Hospital agreement and indigent care | Placeholder | Covered in part by #6. |
| 8 | 4,000+ assessment overrides | Placeholder | No manuscript or source was found. The figure must be tied to a cited page before use. |
| 9 | Tyler IASWorld / WinGAP decisions | Placeholder | Covered in part by #1. The WinGAP county-count claim is on HOLD. |
| 10 | PT-32.1 rollback calculation | Placeholder | Nothing found. |
| 11 | Missing BOC meeting minutes | Placeholder | The "Day Five — Missing Records" video work exists; no article. |
| 12 | County financial oversight | Placeholder | An audit summary and discrepancy report exist (research only). |
| 13 | Jail spending | Placeholder | Nothing found. |
| 14 | Nonviolent detention alternatives | Placeholder | Nothing found. |
| 15 | Animal control funding and registration | Placeholder | Nothing found. |
| 16 | Baldwin and Putnam comparisons | Placeholder | Nothing found. |
| 17 | Data center development | **Imported — draft, needs evidence** | The Putnam DRI #4861 draft (unposted). It is filed under Georgia until a Putnam jurisdiction exists. |
| 18 | Development authority and assessments | Placeholder | A QPublic exemption review exists (research only). |
| 19–24 | Called to Stand Watch; The Boy Who Couldn't Understand Hate; You Wear Your X, I'll Wear Mine; The Kitchen; Separation: Faith and Free Will; AI and the Human Question | Placeholder — personal essays | Not found locally or in Drive. |
| 25 | We the People: The Preamble | Placeholder | Not found. |

**Totals:**
- 4 manuscripts imported, all held as drafts with evidence flags.
- 21 placeholders marked NEEDS ORIGINAL MANUSCRIPT.
- 0 published.
- No article body, quote, date, vote or citation was invented. The decks for the four imported stories were written from each manuscript's own opening, and the owner should review them.

### First feature story

**"Harry Keim Dismissed: Systemwide Failure or One Man Blamed?"** (`/news/harry-keim-dismissed-systemwide-failure-or-one-man-blamed`, draft)

- **Source text:** the November 6, 2026 original report, imported verbatim.
- **Original headline:** "Harry Keim's Removal: When the Problems Are Systemwide, Shouldn't Accountability Be Too?" It is kept as publication-history metadata.
- **Changes made on import (formatting only):**
  - removed the headline, dateline and sign-off lines;
  - turned seven bare legacy URLs into links to the same documents in FORGE;
  - pointed the recording link at the county's original public recording.
- **Source documents attached:** 7 original PDFs. Each was imported into the records library with its official source URL. The SHA-256 was verified on import and again on staging download.
  - 2012-10-02, 2012-12-18 and 2016-02-16 minutes;
  - 2021-10-19 work session;
  - 2025 state performance review;
  - April 21, 2026 packet (March 18 joint minutes);
  - October 28, 2026 agenda.
- **Citations and video:** 9 citations with page or timestamp pinpoints. Each is "not yet checked" until the owner marks it. The county's YouTube recording is embedded.
- **Evidence gaps, carried over from the original verification notes:**
  - the exact motion, mover, seconder and individual votes;
  - direct listening to confirm the announced 3–2 result and counsel's wording;
  - the original 2017 Keim letter;
  - complete contracts and invoices;
  - the approved October 28 minutes and exhibits.

  The text already qualifies each of these. The "over 4,000 overrides" figure is **not** in the manuscript and was not added.
- **Cover image:** none yet; it will be supplied separately. Upload it in the editor's Cover image panel. Tick "illustration" and describe it in the alt text. It must not look like a photograph of the hearing.
- **Status:** DRAFT until the owner reviews and publishes it.

## Running locally

```bash
npm install
npm run db:migrate:local
npm run dev            # http://localhost:8787
```

To sign in locally as owner (local `.wrangler` database only; the script refuses remote flags):

```bash
npm run dev:session -- owner "Local Owner"
```

Paste the printed `document.cookie = …` line into the browser console at http://localhost:8787 and reload.

To import the inventory locally:

```bash
node scripts/editorial/import-legacy.mjs --source-root "C:\Users\<you>\Documents" --target local
```

To check content integrity (duplicate slugs, broken record links, missing images, published placeholders):

```bash
node scripts/editorial/check-content.mjs --target local
```

## Rolling back 0005

The application keeps working with the 0005 columns present, so the normal rollback is to redeploy the previous Worker version.

To remove the imported inventory entries (drafts only; nothing public exists):
1. Delete `articles WHERE legacy_ref IS NOT NULL AND status != 'published'`.
2. Delete their `article_versions`, `article_tags`, `citations` and `content_links` rows.
3. The 7 imported records are ordinary public records. Remove them only deliberately, and keep their R2 originals.

To drop the schema additions (SQLite 3.35+ / D1):
- `DROP TABLE media_assets; DROP TABLE article_series;`
- `ALTER TABLE articles DROP COLUMN …` for each column added in 0005, after dropping the `articles_legacy_ref`, `articles_by_series` and `articles_by_jurisdiction` indexes;
- the same for `citations.verified_at`, `verified_by` and `sort_order`.

Take an export first:

```bash
npx wrangler d1 export DB --env staging --remote --output backup.sql
```
