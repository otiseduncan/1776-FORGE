// Tests the read-only legacy inventory/reconciliation tools against a synthetic export
// built in a temporary directory. These fixtures are test data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const SCRIPTS = join(import.meta.dirname, "..", "scripts", "legacy");
const sha = (b: string) => createHash("sha256").update(b).digest("hex");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "forge-legacy-"));
  const exp = join(root, "export");
  mkdirSync(join(exp, "objects", "docs"), { recursive: true });
  const pdf = "%PDF-1.4 synthetic test fixture";
  writeFileSync(join(exp, "objects", "docs", "a.pdf"), pdf);
  writeFileSync(join(exp, "database.sql"), [
    "CREATE TABLE documents (id TEXT PRIMARY KEY, title TEXT, storage_key TEXT, sha256 TEXT);",
    `INSERT INTO documents VALUES ('1','Fixture A','docs/a.pdf','${sha(pdf)}');`,
  ].join("\n"));
  return { root, exp };
}

const run = (script: string, args: string[]) => {
  try { return { code: 0, out: execFileSync(process.execPath, [join(SCRIPTS, script), ...args], { encoding: "utf8" }) }; }
  catch (e) { const err = e as { status: number; stdout: string }; return { code: err.status, out: err.stdout }; }
};

test("legacy inventory and reconciliation", async (t) => {
  const { root, exp } = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const manifest = join(root, "manifest.json");
  const report = join(root, "report.json");

  await t.test("inventory counts rows and hashes objects without touching the export", () => {
    const before = readFileSync(join(exp, "database.sql"), "utf8");
    assert.equal(run("inventory.mjs", [exp, manifest]).code, 0);
    const m = JSON.parse(readFileSync(manifest, "utf8"));
    assert.equal(m.tables.documents.rows, 1);
    assert.deepEqual(m.tables.documents.storage_columns, ["storage_key"]);
    assert.equal(m.objects.length, 1);
    assert.equal(m.objects[0].key, "docs/a.pdf");
    assert.equal(readFileSync(join(exp, "database.sql"), "utf8"), before);
  });

  await t.test("refuses to write the manifest inside the export", () => {
    assert.notEqual(run("inventory.mjs", [exp, join(exp, "m.json")]).code, 0);
  });

  await t.test("an unchanged export reconciles", () => {
    const r = run("reconcile.mjs", [manifest, exp, report]);
    assert.equal(r.code, 0, r.out);
    const rep = JSON.parse(readFileSync(report, "utf8"));
    assert.equal(rep.reconciled, true);
    assert.equal(rep.references.checked, 1);
    assert.equal(rep.references.hash_checked, 1);
  });

  await t.test("a changed or missing object fails reconciliation", () => {
    writeFileSync(join(exp, "objects", "docs", "a.pdf"), "%PDF-1.4 altered");
    const r = run("reconcile.mjs", [manifest, exp, report]);
    assert.equal(r.code, 2);
    const kinds = JSON.parse(readFileSync(report, "utf8")).problems.map((p: { kind: string }) => p.kind);
    assert.ok(kinds.includes("object_changed"));
    assert.ok(kinds.includes("stored_hash_mismatch"));
  });
});
