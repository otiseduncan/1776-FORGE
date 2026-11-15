# 1776 FORGE

**Fellowship for Open Records and Government Examination.** This is an independent civic research platform with:

- investigative reporting
- an archive of public records
- an interactive map of roads, projects and community reports
- local meetings, votes and budgets
- a Constitution and law library
- a curated directory of research resources
- a free community forum

Reading is always free. Members sign in with Google to post, also for free.

> This repository is the **new** FORGE application. It does not deploy to, read from or modify the legacy Baldwin Minute Watch website, Worker, database, bucket or DNS. See [AGENTS.md](AGENTS.md) and [docs/BLUEPRINT.md](docs/BLUEPRINT.md).

## Stack

- **Cloudflare Workers.** The TypeScript API lives in `src/` and static assets in `public/`, served by Workers Static Assets with SPA fallback.
- **D1** stores structured data (`migrations/`). **R2** stores original record files and map-report photos.
- **Frontend:** a vanilla ES-module single-page app with no build step (`public/js`), using a design system in `public/css` built on the brand tokens.
- **Map:** Leaflet 1.9.4, vendored under `public/vendor/leaflet`, with OpenStreetMap tiles.
- **Auth:** Google OpenID Connect using authorization code + PKCE, state and nonce. Sessions are opaque and stored hashed, with HttpOnly `__Host-` cookies and CSRF tokens.
- **Tests:** `node:test` with a D1-compatible SQLite shim (`test/harness.ts`). No network access is needed.

## Run locally

Requirements: Node 24+ (the tests use built-in TypeScript type stripping and `node:sqlite`) and npm.

```bash
npm install
```

```bash
npm run db:migrate:local
```

```bash
npm run dev
```

Open http://localhost:8787. Local D1 and R2 live under `.wrangler/` on your machine. They are never your Cloudflare account's databases.

### Signing in locally

You have two options:

- **Without Google credentials.** Create a local-only test session:

  ```bash
  npm run dev:session -- editor "Local Editor"
  ```

  Roles are member, contributor, researcher, editor, admin and owner. The script prints a cookie line to paste into the browser console. It only writes to the local `.wrangler` database and refuses `--remote`.
- **With real Google sign-in.** Copy `.env.example` to `.dev.vars` and fill in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Then add `http://localhost:8787/api/auth/google/callback` as an authorized redirect URI on that OAuth client.

## Verify

```bash
npm run check
```

```bash
npm test
```

`check` type-checks the Worker and syntax-checks every frontend module. `npm test` runs the API integration tests (auth, records, community, newsroom, map, law, civic, admin) and the legacy-tool tests.

## Deploy (only after external setup — see docs/IMPLEMENTATION_STATUS.md)

```bash
npm run deploy:staging
```

```bash
npm run deploy:production
```

Both commands run `npm run verify` first. They fail until the placeholder D1 IDs in `wrangler.jsonc` are replaced with **newly created** FORGE databases.

## Documentation

- [docs/BLUEPRINT.md](docs/BLUEPRINT.md): product requirements and design system.
- [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md): feature-by-feature status, external setup and the gap report.
- [docs/MIGRATION.md](docs/MIGRATION.md): the read-only legacy archive inventory and reconciliation procedure.
