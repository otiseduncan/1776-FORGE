# 1776 FORGE — Product blueprint (v0.1)

## Mission
Independent public-interest newsroom and government research platform. Motto: **Debate the issue. Bring the documents.**

## Non-negotiable preservation boundary
The existing Baldwin Minute Watch/legacy site, production deployments, domain, D1 instances, R2 objects, and all original research documents are **read-only and out of scope**. Never run migrations, destructive scripts, deletes, or deploy commands against legacy resources. New repository, Cloudflare Worker, D1, and R2 resources require distinct names/IDs. Before any migration: inventory tables and external files; independently export SQL + original objects; verify counts, cryptographic hashes, and relationships; perform rehearsal imports; produce reconciliation report. Do not imply that copying SQLite rows copies stored PDFs.

## Theme contract
Apply provided owner reference images to the **entire site**, not merely the homepage. Current starter uses a restrained **midnight navy / muted antique gold / warm ivory / slate** token system. Treat reference screenshots as final authority when comparing details. Unified typography, responsive headers, cards, buttons, forms, map controls, reader pages, login, forum, and admin console. Accessible contrast, keyboard navigation, and reduced motion.

## Product areas
- Public newsroom: investigations, articles, citations, editorial workflow, corrections, video, accessible publication pages.
- Public records: federal/state/local jurisdictions, evidence artifacts, immutable original files, source provenance, document versions, indexed search.
- Constitution & Law: official National Archives texts, Constitution Annotated, court opinions, linked cases and statutes; distinguish enacted text, interpretation, and commentary; show version/effective dates; no invented legal holdings.
- Curated resources: agency directory, plain-language descriptions, topic/jurisdiction filters, source-quality labels, link checks.
- Map: retain spatial roadmap (roads, projects, issue reports), import original geospatial data after verification, preserve red/yellow/green/gray semantics, mobile gestures and accessible layer controls.
- Community: public read access, **free membership** required to comment/post, threaded replies, evidence attachments, notices, transparent moderation, report/appeal workflows. Forum is **not paywalled**.
- Contributor workspace: draft/review/publish, source verification, membership/role management, moderation, audit logs.

## Membership
Public visitors read newsroom, archive, map, directory, forum. Free verified members can comment and submit. Editorial roles: member/contributor/researcher/editor/admin/owner; enforce permissions server-side. Future premium publication permissions may exist but checkout/payments disabled at launch. Public records and forum remain free. Never accept raw user-id or role claims from the browser.

## Technical foundations
Cloudflare Workers + static assets; isolated D1 and R2; Google OIDC (PKCE/state/nonce) with secure, HttpOnly session cookies and server-side verification; no fabricated auth implementation. Avoid mixing editorial and community moderation permissions. Content links connect documents, map features, articles, votes, legal authorities, and discussions. Consider FTS5 and scheduled re-indexing only after migration audit.

## Current implementation status
**Current status:** see [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for the verified, feature-by-feature classification, external setup list and gap report. Areas awaiting data or configuration are labelled to visitors in the interface.

## Completion criteria
No changes to legacy infrastructure; independently backed-up original files/rows, migration reconciliation, working Google sign-in, authorized member forum, moderated contributions, accessible map and imported layers, complete publishing pipeline, accurate source links, regression/security/accessibility tests, and staged Cloudflare release.
