# Legacy archive migration runbook

**Status: not started.** No legacy data has been read, exported or imported, because this repository has no access to the legacy Cloudflare account. The tooling below is built and tested against synthetic fixtures only.

## Ground rules

- The legacy Baldwin Minute Watch Worker, D1 database, R2 bucket and DNS are **read-only and out of scope**. Never run `wrangler deploy`, `d1 execute`, `d1 migrations apply`, `r2 object delete/put` or similar commands against them.
- Never point a FORGE environment (dev, staging or production) at a legacy binding.
- Importing database rows does **not** copy the original documents. Every stored object must be downloaded, hashed and reconciled separately.
- Nothing is discarded. Objects that no row references are kept and listed for review.

## 1. Export (performed by the account owner)

Run these from an empty working folder outside this repository. Both are read operations.

```bash
npx wrangler d1 export <LEGACY_DB_NAME> --remote --output export/database.sql
```

Then download every R2 object into `export/objects/<key>`, keeping each object key as its relative path. Use a read-only API token scoped to R2 Object Read. A tool such as `rclone copy` or the S3-compatible API works with a read-only key. Record the bucket's object count from the Cloudflare dashboard.

Make a second, independent copy of `export/` (for example, on external storage) before going on.

## 2. Inventory

```bash
node scripts/legacy/inventory.mjs ./export ./legacy-manifest.json
```

This writes, outside the export:

- per-table row counts, columns and a content fingerprint
- each storage-key column and the number of objects it references
- the size and SHA-256 of every object

It prints the manifest's SHA-256.

Compare the totals against the dashboard counts. If they differ, stop and investigate.

## 3. Reconcile

```bash
node scripts/legacy/reconcile.mjs ./legacy-manifest.json ./export ./legacy-reconciliation.json
```

The reconciliation re-reads the export and checks:

- row counts and content fingerprints
- object hashes
- that every storage key referenced by a row exists
- that every stored SHA-256 column matches the actual file

It exits with a non-zero code if anything fails. **Do not import until the report shows `"reconciled": true`.** Run it again against the second copy to confirm that both copies match.

## 4. Register the batch

In FORGE, go to **Administration → Legacy imports** (`/admin/imports`). Register the batch with:

- the manifest SHA-256
- the expected row and file counts
- the reconciliation report

This creates an auditable ledger entry.

## 5. Map and import (not yet implemented)

Row mapping from the legacy schema into FORGE tables depends on the legacy schema, which has not been inspected. The FORGE `documents` table already supports:

- `imported_legacy_id` (unique)
- `original_sha256`
- `original_storage_key`
- `integrity_state`

The import step to write next will:

1. Rehearse against a scratch local D1 (`--local`).
2. Copy objects into the **new** FORGE R2 bucket under `documents/<year>/<id>/<filename>`, and verify that each object's SHA-256 after upload matches the manifest.
3. Insert rows with `imported_legacy_id` set, so that a re-run is idempotent.
4. Run `POST /api/records/:id/integrity` across all imported records, then produce a final reconciliation report comparing the source and FORGE counts.

## Permissions needed from the owner

- A read-only Cloudflare API token, used to `d1 export` the legacy database.
- A read-only R2 access key for the legacy bucket.
- Confirmation of the legacy database name and bucket name, so that FORGE resources can be named to avoid any collision.
