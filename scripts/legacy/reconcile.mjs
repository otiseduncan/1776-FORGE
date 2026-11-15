#!/usr/bin/env node
// READ-ONLY reconciliation of a legacy export against its manifest.
//
// Re-inventories the export directory and compares it to a previously written manifest:
//   - every table's row count and content fingerprint
//   - every object's size and SHA-256
//   - every storage key referenced from the database exists as an object
//   - every stored hash column (sha256/checksum) matches the actual object hash
// Exits non-zero if anything does not reconcile. Never writes to the export directory
// and never connects to Cloudflare.
//
// Usage: node scripts/legacy/reconcile.mjs <manifest.json> <export-dir> [report-out.json]
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { buildManifest } from "./inventory.mjs";

const [manifestFile, exportDir, reportFile = "legacy-reconciliation.json"] = process.argv.slice(2);
if (!manifestFile || !exportDir) { console.error("Usage: node scripts/legacy/reconcile.mjs <manifest.json> <export-dir> [report-out.json]"); process.exit(1); }
const root = resolve(exportDir);
if (resolve(reportFile).startsWith(root + sep)) { console.error("Write the report outside the export directory."); process.exit(1); }

const expected = JSON.parse(readFileSync(manifestFile, "utf8"));
const actual = await buildManifest(root);
const problems = [];

for (const [name, t] of Object.entries(expected.tables)) {
  const a = actual.tables[name];
  if (!a) { problems.push({ kind: "table_missing", table: name }); continue; }
  if (a.rows !== t.rows) problems.push({ kind: "row_count", table: name, expected: t.rows, actual: a.rows });
  if (a.content_sha256 !== t.content_sha256) problems.push({ kind: "table_content_changed", table: name });
}
for (const name of Object.keys(actual.tables)) if (!expected.tables[name]) problems.push({ kind: "unexpected_table", table: name });

const objects = new Map(actual.objects.map((o) => [o.key, o]));
for (const o of expected.objects) {
  const a = objects.get(o.key);
  if (!a) problems.push({ kind: "object_missing", key: o.key });
  else if (a.sha256 !== o.sha256 || a.bytes !== o.bytes) problems.push({ kind: "object_changed", key: o.key, expected: o.sha256, actual: a.sha256 });
}

// Referential checks against the database rows.
const referencedKeys = new Set();
const referenced = { checked: 0, missing: 0, hash_checked: 0, hash_mismatch: 0 };
const sqlPath = join(root, "database.sql");
if (existsSync(sqlPath)) {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(sqlPath, "utf8"));
  for (const [name, t] of Object.entries(actual.tables)) {
    if (!t.storage_columns?.length) continue;
    const quoted = `"${name.replace(/"/g, '""')}"`;
    for (const row of db.prepare(`SELECT rowid AS _rowid, * FROM ${quoted}`).iterate()) {
      for (const col of t.storage_columns) {
        const key = row[col];
        if (typeof key !== "string" || !key) continue;
        referenced.checked++;
        referencedKeys.add(key.replace(/^\/+/, ""));
        const obj = objects.get(key.replace(/^\/+/, ""));
        if (!obj) { referenced.missing++; problems.push({ kind: "referenced_object_missing", table: name, rowid: row._rowid, column: col, key }); continue; }
        for (const hc of t.hash_columns) {
          const stored = row[hc];
          if (typeof stored !== "string" || !/^[a-f0-9]{64}$/i.test(stored)) continue;
          referenced.hash_checked++;
          if (stored.toLowerCase() !== obj.sha256) { referenced.hash_mismatch++; problems.push({ kind: "stored_hash_mismatch", table: name, rowid: row._rowid, column: hc, key }); }
        }
      }
    }
  }
  db.close();
}
const unreferenced = actual.objects.filter((o) => !referencedKeys.has(o.key)).length;

const report = {
  generated_at: new Date().toISOString(),
  manifest: manifestFile,
  totals: { expected: expected.totals, actual: actual.totals },
  references: referenced,
  objects_total: actual.objects.length,
  objects_unreferenced: unreferenced,
  note_unreferenced: unreferenced ? "Objects not referenced by a known storage column are kept and listed for manual review; they are never discarded." : null,
  problems,
  reconciled: problems.length === 0,
};
writeFileSync(reportFile, JSON.stringify(report, null, 2));
console.log(`Reconciliation report written to ${reportFile}`);
console.log(report.reconciled ? "  RECONCILED — counts, hashes and references match." : `  NOT RECONCILED — ${problems.length} problem(s). Do not import until resolved.`);
process.exit(report.reconciled ? 0 : 2);
