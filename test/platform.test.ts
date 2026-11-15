import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createApp, PDF_BYTES } from "./harness.ts";

const LINE = { type: "LineString", coordinates: [[-83.2321, 33.0801], [-83.2201, 33.0841]] };

describe("interactive map data", () => {
  test("no fabricated features; condition ratings must cite a source", async () => {
    const app = createApp();
    const fc = await app.call("GET", "/api/map/features");
    assert.deepEqual(fc.body, { type: "FeatureCollection", features: [] });
    const r = await app.user("researcher");
    const member = await app.user("member");
    assert.equal((await app.call("POST", "/api/map/features", { user: member, body: { kind: "road", title: "Main St", geometry: LINE } })).status, 403);
    assert.equal((await app.call("POST", "/api/map/features", { user: r, body: { kind: "road", title: "Main St", geometry: LINE, condition_state: "red" } })).status, 422);
    assert.equal((await app.call("POST", "/api/map/features", { user: r, body: { kind: "road", title: "Main St", geometry: { type: "LineString", coordinates: [[500, 1]] } } })).status, 422);
    const ok = await app.call("POST", "/api/map/features", { user: r, body: { kind: "road", title: "Main St", geometry: LINE, jurisdiction_id: "ga-milledgeville", condition_state: "red", condition_note: "Potholes cited in report", source_url: "https://example.gov/roads-report.pdf" } });
    assert.equal(ok.status, 201);
    const gray = await app.call("POST", "/api/map/features", { user: r, body: { kind: "project", title: "Unrated project", geometry: { type: "Point", coordinates: [-83.23, 33.08] }, condition_state: "gray" } });
    assert.equal(gray.status, 201, "gray = no rating, needs no source");
    const all = await app.call("GET", "/api/map/features");
    assert.equal(all.body.features.length, 2);
    assert.equal((await app.call("GET", "/api/map/features?kind=road")).body.features.length, 1);
    assert.equal((await app.call("GET", "/api/map/features?jurisdiction=ga-baldwin")).body.features.length, 1, "county filter includes its cities");
    const detail = await app.call("GET", `/api/map/features/${ok.body.id}`);
    assert.equal(detail.body.citations[0].url, "https://example.gov/roads-report.pdf");
    assert.equal(detail.body.feature.created_by, undefined);
  });

  test("community problem reports are moderated before publication, with photo evidence", async () => {
    const app = createApp();
    const member = await app.user("member");
    const mod = await app.user("editor");
    assert.equal((await app.call("POST", "/api/map/reports", { body: { title: "Pothole", description: "Large pothole", lat: 33.08, lng: -83.23 } })).status, 401);
    const rep = await app.call("POST", "/api/map/reports", { user: member, body: { title: "Deep pothole on Hancock St", description: "Approximately 2 ft wide near the crosswalk.", category: "road_condition", lat: 33.08, lng: -83.23 } });
    assert.equal(rep.status, 201);
    const form = new FormData();
    form.append("file", new File([PDF_BYTES as BlobPart], "evidence.pdf", { type: "application/pdf" }));
    const att = await app.call("POST", `/api/map/reports/${rep.body.id}/attachments`, { user: member, form });
    assert.equal(att.status, 201);
    assert.equal((await app.call("GET", "/api/map/reports")).body.features.length, 0, "pending reports are not public");
    assert.equal((await app.call("GET", `/api/attachments/${att.body.id}`)).status, 404, "pending evidence is not public");
    assert.equal((await app.call("GET", "/api/map/reports?mine=1", { user: member })).body.features.length, 1);
    assert.equal((await app.call("POST", `/api/map/reports/${rep.body.id}/review`, { user: mod, body: { decision: "rejected" } })).status, 422);
    assert.equal((await app.call("POST", `/api/map/reports/${rep.body.id}/review`, { user: mod, body: { decision: "approved" } })).status, 200);
    const pub = await app.call("GET", "/api/map/reports");
    assert.equal(pub.body.features.length, 1);
    assert.deepEqual(pub.body.features[0].geometry.coordinates, [-83.23, 33.08]);
    assert.equal(pub.body.features[0].properties.author_id, undefined);
    assert.equal((await app.call("GET", `/api/attachments/${att.body.id}`)).status, 200);
    assert.match((await app.call("GET", "/api/notifications", { user: member })).body.items[0].message, /approved/);
  });
});

describe("meetings, votes and budgets", () => {
  async function setup() {
    const app = createApp();
    const r = await app.user("researcher");
    const body = await app.call("POST", "/api/civic/bodies", { user: r, body: { jurisdiction_id: "ga-baldwin", name: "Board of Commissioners", official_url: "https://example.gov/boc" } });
    const o1 = await app.call("POST", "/api/civic/officials", { user: r, body: { body_id: body.body.id, name: "Commissioner A", office: "Commissioner", district: "1", source_url: "https://example.gov/boc/members" } });
    const o2 = await app.call("POST", "/api/civic/officials", { user: r, body: { body_id: body.body.id, name: "Commissioner B", office: "Commissioner", district: "2", source_url: "https://example.gov/boc/members" } });
    return { app, r, bodyId: body.body.id as string, o1: o1.body.id as string, o2: o2.body.id as string };
  }

  test("meetings and votes must be sourced; voting records aggregate", async () => {
    const { app, r, bodyId, o1, o2 } = await setup();
    assert.equal((await app.call("POST", "/api/civic/meetings", { user: r, body: { body_id: bodyId, meeting_date: "2024-03-05", title: "Regular meeting" } })).status, 422);
    const noMinutes = await app.call("POST", "/api/civic/meetings", { user: r, body: { body_id: bodyId, meeting_date: "2024-03-05", title: "Regular meeting", source_url: "https://example.gov/agenda" } });
    assert.equal(noMinutes.status, 201);
    assert.equal((await app.call("POST", `/api/civic/meetings/${noMinutes.body.id}/motions`, { user: r, body: { title: "Approve paving contract", votes: [] } })).status, 422, "votes need minutes, transcript, video or a supporting record");
    const doc = await app.call("POST", "/api/records", { user: r, body: { title: "Minutes 2024-03-19", category_id: "minutes", jurisdiction_id: "ga-baldwin" } });
    const m = await app.call("POST", "/api/civic/meetings", { user: r, body: { body_id: bodyId, meeting_date: "2024-03-19", title: "Regular meeting", minutes_document_id: doc.body.id } });
    assert.equal((await app.call("POST", `/api/civic/meetings/${m.body.id}/motions`, { user: r, body: { title: "x", votes: [{ official_id: "stranger", vote: "yea" }] } })).status, 422);
    assert.equal((await app.call("POST", `/api/civic/meetings/${m.body.id}/motions`, { user: r, body: { title: "x", votes: [{ official_id: o1, vote: "maybe" }] } })).status, 422);
    const motion = await app.call("POST", `/api/civic/meetings/${m.body.id}/motions`, { user: r, body: { item_number: "7a", title: "Approve paving contract", resolution_number: "2024-12", moved_by: o1, seconded_by: o2, result: "passed", source_pinpoint: "Minutes p. 4", votes: [{ official_id: o1, vote: "yea" }, { official_id: o2, vote: "nay" }] } });
    assert.equal(motion.status, 201);
    const detail = await app.call("GET", `/api/civic/meetings/${m.body.id}`);
    assert.equal(detail.body.meeting.minutes_title, "Minutes 2024-03-19");
    assert.equal(detail.body.motions[0].votes.length, 2);
    assert.equal((await app.call("GET", `/api/civic/officials/${o2}`)).body.tally.nay, 1);
    assert.equal((await app.call("GET", `/api/records/${doc.body.id}`)).body.meetings.length, 1, "record shows the meeting that cites it");
    assert.equal((await app.call("GET", "/api/search?q=2024-12&types=meetings")).body.groups.meetings.length, 1);
  });

  test("budgets: sourced, line items, fiscal-year comparison; audited reports name the auditor", async () => {
    const { app, r } = await setup();
    assert.equal((await app.call("POST", "/api/civic/budgets", { user: r, body: { jurisdiction_id: "ga-baldwin", fiscal_year: 2024, title: "FY2024 Adopted" } })).status, 422);
    const b24 = await app.call("POST", "/api/civic/budgets", { user: r, body: { jurisdiction_id: "ga-baldwin", fiscal_year: 2024, title: "FY2024 Adopted", source_url: "https://example.gov/fy24.pdf" } });
    const b25 = await app.call("POST", "/api/civic/budgets", { user: r, body: { jurisdiction_id: "ga-baldwin", fiscal_year: 2025, title: "FY2025 Adopted", source_url: "https://example.gov/fy25.pdf" } });
    assert.equal((await app.call("POST", `/api/civic/budgets/${b24.body.id}/lines`, { user: r, body: { lines: [{ department: "Roads", line_type: "expenditure", amount_cents: 1.5 }] } })).status, 422);
    await app.call("POST", `/api/civic/budgets/${b24.body.id}/lines`, { user: r, body: { lines: [{ department: "Roads", line_type: "expenditure", amount_cents: 100000 }, { department: "Sheriff", line_type: "expenditure", amount_cents: 500000 }] } });
    await app.call("POST", `/api/civic/budgets/${b25.body.id}/lines`, { user: r, body: { lines: [{ department: "Roads", line_type: "expenditure", amount_cents: 150000 }] } });
    const cmp = await app.call("GET", "/api/civic/budgets/compare?jurisdiction=ga-baldwin");
    assert.deepEqual(cmp.body.years, [2024, 2025]);
    const roads = cmp.body.rows.find((x: { department: string }) => x.department === "Roads");
    assert.deepEqual(roads.amounts, { 2024: 100000, 2025: 150000 });
    const list = await app.call("GET", "/api/civic/budgets?jurisdiction=ga-baldwin");
    assert.equal(list.body.budgets.find((x: { fiscal_year: number }) => x.fiscal_year === 2024).expenditure_cents, 600000);
    assert.equal((await app.call("POST", "/api/civic/financial-reports", { user: r, body: { jurisdiction_id: "ga-baldwin", fiscal_year: 2023, report_type: "ACFR", audited: true, source_url: "https://example.gov/acfr" } })).status, 422);
    assert.equal((await app.call("POST", "/api/civic/financial-reports", { user: r, body: { jurisdiction_id: "ga-baldwin", fiscal_year: 2023, report_type: "ACFR", audited: true, auditor: "Example CPA LLC", source_url: "https://example.gov/acfr" } })).status, 201);
  });
});

describe("constitution & law", () => {
  test("seeded authorities are complete for founding documents and Amendments I–XXVII, with official sources", async () => {
    const app = createApp();
    const res = await app.call("GET", "/api/law?category=amendment");
    const ids = res.body.items.map((x: { id: string }) => x.id);
    for (let i = 1; i <= 27; i++) assert.ok(ids.includes(`amendment-${i}`), `amendment ${i}`);
    const all = (await app.call("GET", "/api/law")).body.items;
    for (const a of all) assert.match(a.source_url, /^https:\/\//);
    const eighteenth = all.find((x: { id: string }) => x.id === "amendment-18");
    assert.equal(eighteenth.status, "repealed");
    assert.equal(eighteenth.repealed_at, "1933-12-05");
    assert.equal(all.filter((x: { category: string }) => x.category.endsWith("_case")).length, 0, "no court decisions are fabricated");
    assert.ok(all.every((x: { has_text: number }) => x.has_text === 0), "no legal text is invented; text must be imported from the source");
  });

  test("court decisions require citation, court and date; legal text requires its source", async () => {
    const app = createApp();
    const r = await app.user("researcher");
    assert.equal((await app.call("POST", "/api/law", { user: r, body: { category: "federal_case", title: "Example v. Example", source_url: "https://example.gov/op.pdf" } })).status, 422);
    assert.equal((await app.call("POST", "/api/law", { user: r, body: { category: "state_statute", title: "Some act", source_url: "https://example.gov/act", body_text: "Text" } })).status, 422);
    const ok = await app.call("POST", "/api/law", { user: r, body: { category: "federal_case", title: "Example v. Example", citation: "1 U.S. 1", court: "Supreme Court of the United States", decided_at: "1800-01-01", source_url: "https://example.gov/op.pdf" } });
    assert.equal(ok.status, 201);
    await app.call("POST", "/api/links", { user: r, body: { source_type: "legal", source_id: ok.body.id, target_type: "legal", target_id: "amendment-1", relationship: "interprets" } });
    const amendment = await app.call("GET", "/api/law/amendment-1");
    assert.equal(amendment.body.layers.interpretation.length, 1);
    assert.equal(amendment.body.layers.commentary.length, 0);
  });
});

describe("resource directory, search and home", () => {
  test("seeded resources are unverified until checked, with filters", async () => {
    const app = createApp();
    const res = await app.call("GET", "/api/resources");
    assert.ok(res.body.items.length >= 20);
    assert.ok(res.body.items.every((x: { status: string }) => x.status === "unverified"));
    assert.ok(res.body.items.every((x: { description: string }) => x.description.length > 30), "every resource explains itself");
    assert.ok((await app.call("GET", "/api/resources?level=state")).body.items.every((x: { level: string }) => x.level === "state"));
    assert.ok((await app.call("GET", "/api/resources?topic=Court%20decisions")).body.items.length >= 3);
    const archives = res.body.items.find((x: { id: string }) => x.id === "archives");
    assert.equal(archives.subpages.length, 4);
  });

  test("link checker classifies responses and only editors run it", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (u: RequestInfo | URL) => new Response("", { status: String(u).includes("congress") ? 404 : 200 })) as typeof fetch;
    try {
      const app = createApp();
      const member = await app.user("member");
      const editor = await app.user("editor");
      assert.equal((await app.call("POST", "/api/resources/congress/check", { user: member })).status, 403);
      assert.equal((await app.call("POST", "/api/resources/congress/check", { user: editor })).body.status, "broken");
      assert.equal((await app.call("POST", "/api/resources/archives/check", { user: editor })).body.status, "verified");
      assert.equal((await app.call("POST", "/api/resources", { user: editor, body: { name: "Bad", url: "javascript:alert(1)", description: "x".repeat(30), category: "X", level: "federal" } })).status, 422);
      assert.equal((await app.call("POST", "/api/resources", { user: editor, body: { name: "New resource", url: "https://www.example.gov/", description: "An explanation of what researchers can find here.", category: "Testing", level: "county", topics: ["Testing"] } })).status, 201);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("site search spans modules and home aggregates real counts", async () => {
    const app = createApp();
    const s = await app.call("GET", "/api/search?q=amendment");
    assert.ok(s.body.groups.law.length >= 8);
    assert.equal((await app.call("GET", "/api/search?q=a")).status, 422);
    const home = await app.call("GET", "/api/home");
    assert.equal(home.body.stats.records, 0);
    assert.equal(home.body.stats.articles, 0);
    assert.equal(home.body.jurisdictions.length, 4);
    const j = await app.call("GET", "/api/jurisdictions/ga-baldwin");
    assert.equal(j.body.parent.id, "ga");
    assert.equal(j.body.children[0].id, "ga-milledgeville");
  });

  test("API error handling: unknown routes, wrong methods, malformed JSON, missing database", async () => {
    const app = createApp();
    assert.equal((await app.call("GET", "/api/nope")).status, 404);
    assert.equal((await app.call("PUT", "/api/records")).status, 405);
    const u = await app.user("researcher");
    const malformed = await app.call("POST", "/api/records", { user: u, headers: { "content-type": "application/json" } });
    assert.equal(malformed.status, 400);
    const wrongType = await app.call("POST", "/api/records", { user: u, headers: { "content-type": "text/plain" } });
    assert.equal(wrongType.status, 415);
    const noDb = createApp({ DB: undefined });
    assert.equal((await noDb.call("GET", "/api/records")).status, 503);
    assert.equal((await noDb.call("GET", "/api/resources")).body.source, "starter");
    assert.equal((await noDb.call("GET", "/api/health")).body.databaseConfigured, false);
  });
});
