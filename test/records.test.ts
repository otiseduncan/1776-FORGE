import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createApp, PDF_BYTES } from "./harness.ts";
import { sha256Hex } from "../src/lib/crypto.ts";

function pdfForm(bytes = PDF_BYTES, name = "minutes.pdf", type = "application/pdf") {
  const f = new FormData();
  f.append("file", new File([bytes as BlobPart], name, { type }));
  return f;
}

describe("public records library", () => {
  test("anyone can browse; only researchers can create", async () => {
    const app = createApp();
    const list = await app.call("GET", "/api/records");
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 0, "no records are fabricated by migrations");
    const anon = await app.call("POST", "/api/records", { body: { title: "Test" } });
    assert.equal(anon.status, 401);
    const member = await app.user("member");
    assert.equal((await app.call("POST", "/api/records", { user: member, body: { title: "Board minutes" } })).status, 403);
  });

  test("create, search, filter and view a record with validation", async () => {
    const app = createApp();
    const r = await app.user("researcher");
    const bad = await app.call("POST", "/api/records", { user: r, body: { title: "Minutes", source_url: "http://insecure.example" } });
    assert.equal(bad.status, 422);
    const badDate = await app.call("POST", "/api/records", { user: r, body: { title: "Minutes", record_date: "03/04/2024" } });
    assert.equal(badDate.status, 422);
    const created = await app.call("POST", "/api/records", { user: r, body: { title: "County Commission Minutes", category_id: "minutes", jurisdiction_id: "ga-baldwin", record_date: "2024-03-05", source_url: "https://example.gov/minutes.pdf", summary: "Regular session" } });
    assert.equal(created.status, 201);
    await app.call("POST", "/api/records", { user: r, body: { title: "State audit report", category_id: "audit", jurisdiction_id: "ga", record_date: "2023-06-30" } });

    const byQ = await app.call("GET", "/api/records?q=commission");
    assert.equal(byQ.body.total, 1);
    const byLevel = await app.call("GET", "/api/records?level=state");
    assert.equal(byLevel.body.items[0].title, "State audit report");
    const byCat = await app.call("GET", "/api/records?category=minutes&from=2024-01-01&to=2024-12-31");
    assert.equal(byCat.body.total, 1);
    const wildcard = await app.call("GET", "/api/records?q=%25");
    assert.equal(wildcard.body.total, 0, "LIKE wildcards are escaped");

    const detail = await app.call("GET", `/api/records/${created.body.id}`);
    assert.equal(detail.body.document.jurisdiction_name, "Baldwin County");
    assert.equal(detail.body.document.verification_state, "unreviewed");
    const facets = await app.call("GET", "/api/records/facets");
    assert.ok(facets.body.categories.find((c: { id: string; n: number }) => c.id === "minutes").n === 1);
  });

  test("duplicate detection by source URL and by title/date/jurisdiction", async () => {
    const app = createApp();
    const r = await app.user("researcher");
    const body = { title: "FY2024 Budget", record_date: "2023-07-01", jurisdiction_id: "ga-baldwin", source_url: "https://example.gov/budget.pdf" };
    assert.equal((await app.call("POST", "/api/records", { user: r, body })).status, 201);
    const dupUrl = await app.call("POST", "/api/records", { user: r, body: { title: "Other title", source_url: body.source_url } });
    assert.equal(dupUrl.status, 409);
    assert.equal(dupUrl.body.details.duplicates.length, 1);
    const dupMeta = await app.call("POST", "/api/records", { user: r, body: { ...body, source_url: undefined, title: "fy2024 budget" } });
    assert.equal(dupMeta.status, 409);
    const forced = await app.call("POST", "/api/records", { user: r, body: { ...body, source_url: undefined, force: true } });
    assert.equal(forced.status, 201);
  });

  test("original file upload: type sniffing, SHA-256, immutability, duplicate files, preview & download", async () => {
    const app = createApp();
    const r = await app.user("researcher");
    const other = await app.user("researcher");
    const { body: { id } } = await app.call("POST", "/api/records", { user: r, body: { title: "Minutes March 2024" } });
    const fake = await app.call("POST", `/api/records/${id}/file`, { user: r, form: pdfForm(new TextEncoder().encode("<html><script>alert(1)</script>"), "x.pdf") });
    assert.equal(fake.status, 415, "HTML disguised as PDF is rejected");
    assert.equal((await app.call("POST", `/api/records/${id}/file`, { user: other, form: pdfForm() })).status, 403);
    const up = await app.call("POST", `/api/records/${id}/file`, { user: r, form: pdfForm() });
    assert.equal(up.status, 201);
    assert.equal(up.body.sha256, await sha256Hex(PDF_BYTES));
    assert.equal((await app.call("POST", `/api/records/${id}/file`, { user: r, form: pdfForm() })).status, 409, "originals are immutable");
    const { body: { id: id2 } } = await app.call("POST", "/api/records", { user: r, body: { title: "Copy of minutes" } });
    const dup = await app.call("POST", `/api/records/${id2}/file`, { user: r, form: pdfForm() });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.details.duplicates[0].id, id);

    const inline = await app.call("GET", `/api/records/${id}/file`);
    assert.equal(inline.status, 200);
    assert.equal(inline.headers.get("content-type"), "application/pdf");
    assert.match(inline.headers.get("content-disposition")!, /^inline/);
    assert.equal(inline.headers.get("x-content-type-options"), "nosniff");
    const dl = await app.call("GET", `/api/records/${id}/file?download=1`);
    assert.match(dl.headers.get("content-disposition")!, /^attachment; filename="minutes.pdf"/);
    assert.deepEqual(new Uint8Array(dl.body), PDF_BYTES);
  });

  test("integrity check detects tampering and missing objects", async () => {
    const app = createApp();
    const r = await app.user("researcher");
    const editor = await app.user("editor");
    const { body: { id } } = await app.call("POST", "/api/records", { user: r, body: { title: "Contract award" } });
    await app.call("POST", `/api/records/${id}/file`, { user: r, form: pdfForm() });
    assert.equal((await app.call("POST", `/api/records/${id}/integrity`, { user: r })).status, 403);
    assert.equal((await app.call("POST", `/api/records/${id}/integrity`, { user: editor })).body.state, "ok");
    const key = [...app.r2.objects.keys()][0];
    app.r2.objects.get(key)!.bytes = new TextEncoder().encode("%PDF-tampered");
    assert.equal((await app.call("POST", `/api/records/${id}/integrity`, { user: editor })).body.state, "mismatch");
    app.r2.objects.clear();
    assert.equal((await app.call("POST", `/api/records/${id}/integrity`, { user: editor })).body.state, "missing");
  });

  test("only editors change verification status; changes are audited", async () => {
    const app = createApp();
    const r = await app.user("researcher");
    const editor = await app.user("editor");
    const { body: { id } } = await app.call("POST", "/api/records", { user: r, body: { title: "Open records response" } });
    assert.equal((await app.call("PATCH", `/api/records/${id}`, { user: r, body: { verification_state: "verified" } })).status, 403);
    assert.equal((await app.call("PATCH", `/api/records/${id}`, { user: editor, body: { verification_state: "verified" } })).status, 200);
    assert.equal((await app.call("GET", `/api/records/${id}`)).body.document.verification_state, "verified");
    const audit = app.d1.db.prepare("SELECT action FROM audit_events WHERE subject_id = ? ORDER BY created_at").all(id) as { action: string }[];
    assert.deepEqual(audit.map((a) => a.action), ["document.created", "document.verification_changed"]);
  });

  test("staff-only records are hidden from the public", async () => {
    const app = createApp();
    const r = await app.user("researcher");
    const { body: { id } } = await app.call("POST", "/api/records", { user: r, body: { title: "Unreleased draft", visibility: "staff" } });
    assert.equal((await app.call("GET", `/api/records/${id}`)).status, 404);
    assert.equal((await app.call("GET", "/api/records")).body.total, 0);
    assert.equal((await app.call("GET", `/api/records/${id}`, { user: r })).status, 200);
  });

  test("links and citations connect records to other content", async () => {
    const app = createApp();
    const r = await app.user("researcher");
    const { body: { id: a } } = await app.call("POST", "/api/records", { user: r, body: { title: "Original contract" } });
    const { body: { id: b } } = await app.call("POST", "/api/records", { user: r, body: { title: "Change order 1" } });
    assert.equal((await app.call("POST", "/api/links", { user: r, body: { source_type: "document", source_id: b, target_type: "document", target_id: a, relationship: "responds_to" } })).status, 201);
    assert.equal((await app.call("POST", "/api/links", { user: r, body: { source_type: "document", source_id: b, target_type: "document", target_id: a, relationship: "responds_to" } })).status, 409);
    assert.equal((await app.call("POST", "/api/links", { user: r, body: { source_type: "document", source_id: b, target_type: "legal", target_id: "ga-open-records", relationship: "about" } })).status, 201);
    assert.equal((await app.call("POST", "/api/links", { user: r, body: { source_type: "document", source_id: b, target_type: "legal", target_id: "made-up" } })).status, 404);
    const detail = await app.call("GET", `/api/records/${a}`);
    assert.equal(detail.body.related[0].title, "Change order 1");
    assert.equal(detail.body.related[0].direction, "incoming");
    assert.equal((await app.call("POST", "/api/citations", { user: r, body: { subject_type: "document", subject_id: a, label: "Agency website" } })).status, 422);
    assert.equal((await app.call("POST", "/api/citations", { user: r, body: { subject_type: "document", subject_id: a, label: "Agency website", url: "https://example.gov" } })).status, 201);
    assert.equal((await app.call("GET", `/api/records/${a}`)).body.citations.length, 1);
  });
});
