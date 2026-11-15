#!/usr/bin/env node
// READ-ONLY legacy archive inventory.
//
// Works on an *exported copy* of the legacy archive on local disk. It never connects to
// Cloudflare, never calls wrangler, and never writes inside the export directory.
//
// Expected export layout (see docs/MIGRATION.md for how to produce it safely):
//   <export>/database.sql   — output of `wrangler d1 export <legacy-db> --remote --output database.sql`
//   <export>/objects/...    — every R2 object, downloaded with its key as the relative path
//
// Usage: node scripts/legacy/inventory.mjs <export-dir> [manifest-out.json]
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, createReadStream } from "node:fs";
import { join, relative, sep, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [exportDir, outFile = "legacy-manifest.json"] = process.argv.slice(2);
if (!exportDir) { console.error("Usage: node scripts/legacy/inventory.mjs <export-dir> [manifest-out.json]"); process.exit(1); }
const root = resolve(exportDir);
const sqlFile = join(root, "database.sql");
const objectsDir = join(root, "objects");
if (resolve(outFile).startsWith(root + sep)) { console.error("Write the manifest outside the export directory so the export stays untouched."); process.exit(1); }

const sha256File = (path) => new Promise((ok, fail) => {
  const hash = createHash("sha256");
  createReadStream(path).on("data", (d) => hash.update(d)).on("end", () => ok(hash.digest("hex"))).on("error", fail);
});

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
}

export async function buildManifest(rootDir) {
  const manifest = { generated_at: new Date().toISOString(), tool: "forge-legacy-inventory/1", export_dir: rootDir, database: null, tables: {}, objects: [], warnings: [] };
  const sqlPath = join(rootDir, "database.sql");
  if (existsSync(sqlPath)) {
    const sql = readFileSync(sqlPath, "utf8");
    manifest.database = { file: "database.sql", bytes: Buffer.byteLength(sql), sha256: createHash("sha256").update(sql).digest("hex") };
    // Load the dump into a throwaway in-memory database purely to count and inspect rows.
    const db = new DatabaseSync(":memory:");
    db.exec(sql);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all();
    for (const { name } of tables) {
      const quoted = `"${name.replace(/"/g, '""')}"`;
      const columns = db.prepare(`PRAGMA table_info(${quoted})`).all().map((c) => c.name);
      const count = db.prepare(`SELECT COUNT(*) AS n FROM ${quoted}`).get().n;
      // Row-content fingerprint: hash of every row in primary-key/rowid order.
      const hash = createHash("sha256");
      for (const row of db.prepare(`SELECT * FROM ${quoted} ORDER BY rowid`).iterate()) hash.update(JSON.stringify(row) + "\n");
      const storageColumns = columns.filter((c) => /(storage_key|r2_key|object_key|file_key|file_path)$/i.test(c));
      const hashColumns = columns.filter((c) => /sha256|checksum|hash/i.test(c));
      manifest.tables[name] = { rows: count, columns, content_sha256: hash.digest("hex"), storage_columns: storageColumns, hash_columns: hashColumns };
      if (storageColumns.length) {
        manifest.tables[name].referenced_objects = db.prepare(`SELECT ${storageColumns.map((c) => `"${c}"`).join(",")} FROM ${quoted}`).all()
          .flatMap((r) => Object.values(r)).filter((v) => typeof v === "string" && v.length).length;
      }
    }
    db.close();
  } else manifest.warnings.push("database.sql not found — no database rows were inventoried");

  const objDir = join(rootDir, "objects");
  if (existsSync(objDir)) {
    for (const p of walk(objDir).sort()) {
      const st = statSync(p);
      manifest.objects.push({ key: relative(objDir, p).split(sep).join("/"), bytes: st.size, sha256: await sha256File(p) });
    }
  } else manifest.warnings.push("objects/ not found — no stored files were inventoried. Copying database rows does NOT copy the original documents.");
  manifest.totals = { tables: Object.keys(manifest.tables).length, rows: Object.values(manifest.tables).reduce((n, t) => n + t.rows, 0), objects: manifest.objects.length, object_bytes: manifest.objects.reduce((n, o) => n + o.bytes, 0) };
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!existsSync(sqlFile) && !existsSync(objectsDir)) { console.error(`Nothing to inventory in ${root} (expected database.sql and/or objects/).`); process.exit(1); }
  const manifest = await buildManifest(root);
  const text = JSON.stringify(manifest, null, 2);
  writeFileSync(outFile, text);
  console.log(`Manifest written to ${outFile}`);
  console.log(`  tables: ${manifest.totals.tables}  rows: ${manifest.totals.rows}  objects: ${manifest.totals.objects} (${manifest.totals.object_bytes} bytes)`);
  console.log(`  manifest sha256: ${createHash("sha256").update(text).digest("hex")}`);
  for (const w of manifest.warnings) console.warn("  WARNING: " + w);
}
