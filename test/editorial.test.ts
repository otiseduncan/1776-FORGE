import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createApp, PDF_BYTES } from "./harness.ts";
import { imageSize, injectMeta, pageMetaFor, sitemap, robots } from "../src/routes/editorial.ts";
import { readingMinutes } from "../src/routes/news.ts";
// @ts-expect-error — plain ESM script without type declarations
import { transform, buildPlan, planToSql, stableId, sha256 } from "../scripts/editorial/import-legacy.mjs";

// 1×1 PNG and a 3×2 PNG header (only the header is needed for size detection)
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));

async function story(app: ReturnType<typeof createApp>, user: Awaited<ReturnType<ReturnType<typeof createApp>["user"]>>, extra: Record<string, unknown> = {}) {
  const r = await app.call("POST", "/api/news", { user, body: { title: "County budget hearing report", body: "## Heading\n\nThe county held a hearing on the budget proposal today.", kind: "report", ...extra } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body as { id: string; slug: string };
}

describe("editorial publishing", () => {
  test("article metadata round-trips and new story types are accepted", async () => {
    const app = createApp();
    const owner = await app.user("owner", "Owner");
    const s = await story(app, owner, {
      kind: "personal_essay", category_id: "essays", jurisdiction_id: "ga-baldwin", excerpt: "Short teaser.", byline: "A. Writer",
      original_publisher: "Earlier Publication", original_published_at: "2026-11-06", original_headline: "Old headline", seo_title: "Search title",
      seo_description: "Search description", keywords: ["budget", "hearing"], tags: ["Budget"],
    });
    const r = await app.call("GET", `/api/news/${s.id}`, { user: owner });
    const a = r.body.article;
    assert.equal(a.kind, "personal_essay");
    assert.equal(a.byline, "A. Writer");
    assert.equal(a.original_publisher, "Earlier Publication");
    assert.equal(a.original_published_at, "2026-11-06");
    assert.equal(a.keywords, "budget, hearing");
    assert.equal(a.jurisdiction_name, "Baldwin County");
    assert.ok(a.reading_minutes >= 1);
    assert.equal((await app.call("POST", "/api/news", { user: owner, body: { title: "Bad kind story", body: "Body text that is long enough.", kind: "rumor" } })).status, 422);
    assert.equal((await app.call("POST", "/api/news", { user: owner, body: { title: "Bad jurisdiction", body: "Body text that is long enough.", jurisdiction_id: "nowhere" } })).status, 422);
    assert.equal(readingMinutes(460), 2);
  });

  test("drafts are private, publishing is public, unpublishing takes a story offline, slugs are stable", async () => {
    const app = createApp();
    const editor = await app.user("editor");
    const writer = await app.user("contributor");
    const s = await story(app, writer);
    assert.equal((await app.call("GET", `/api/news/${s.slug}`)).status, 404, "draft hidden from readers");
    assert.equal((await app.call("GET", `/api/news/${s.slug}`, { user: writer })).status, 200, "author can preview");
    assert.equal((await app.call("POST", `/api/news/${s.id}/submit`, { user: writer })).status, 200);
    assert.equal((await app.call("POST", `/api/news/${s.id}/review`, { user: editor, body: { decision: "publish" } })).status, 200);
    assert.equal((await app.call("GET", `/api/news/${s.slug}`)).status, 200);
    assert.equal((await app.call("GET", "/api/news")).body.total, 1);
    assert.equal((await app.call("PATCH", `/api/news/${s.id}`, { user: editor, body: { slug: "new-url", change_note: "try to move" } })).status, 409, "published URL is fixed");
    assert.equal((await app.call("POST", `/api/news/${s.id}/unpublish`, { user: writer, body: { reason: "Not allowed" } })).status, 403);
    assert.equal((await app.call("POST", `/api/news/${s.id}/unpublish`, { user: editor, body: { reason: "Holding for a correction" } })).status, 200);
    assert.equal((await app.call("GET", `/api/news/${s.slug}`)).status, 404, "unpublished story is offline");
    const audit = app.d1.db.prepare("SELECT action FROM audit_events WHERE subject_id = ? ORDER BY created_at").all(s.id).map((r) => r.action);
    assert.ok(audit.includes("article.unpublished"));
  });

  test("placeholders cannot be published; evidence gaps need explicit acknowledgement; only editors set manuscript status", async () => {
    const app = createApp();
    const owner = await app.user("owner");
    const writer = await app.user("contributor");
    assert.equal((await app.call("POST", "/api/news", { user: writer, body: { title: "Writer story here", body: "A body that is long enough.", manuscript_state: "imported" } })).status, 403);
    const p = await story(app, owner, { manuscript_state: "needs_manuscript" });
    const blocked = await app.call("POST", `/api/news/${p.id}/review`, { user: owner, body: { decision: "publish" } });
    assert.equal(blocked.status, 409);
    const e = await story(app, owner, { title: "Evidence gaps story", manuscript_state: "needs_evidence" });
    const gap = await app.call("POST", `/api/news/${e.id}/review`, { user: owner, body: { decision: "publish" } });
    assert.equal(gap.status, 409);
    assert.equal(gap.body.details.code, "evidence_gaps");
    assert.equal((await app.call("POST", `/api/news/${e.id}/review`, { user: owner, body: { decision: "publish", acknowledge_evidence_gaps: true } })).status, 200);
  });

  test("search and filters: query, type, jurisdiction, series", async () => {
    const app = createApp();
    const owner = await app.user("owner");
    const series = await app.call("POST", "/api/series", { user: owner, body: { title: "Assessor oversight", kind: "investigation", status: "published" } });
    assert.equal(series.status, 201);
    const a = await story(app, owner, { title: "Assessors review findings", jurisdiction_id: "ga-baldwin", kind: "investigation", series_id: series.body.id, series_order: 1, keywords: ["iasWorld"] });
    const b = await story(app, owner, { title: "Statewide rollback explainer", jurisdiction_id: "ga", kind: "explainer" });
    for (const s of [a, b]) await app.call("POST", `/api/news/${s.id}/review`, { user: owner, body: { decision: "publish" } });
    assert.equal((await app.call("GET", "/api/news?jurisdiction=ga-baldwin")).body.total, 1);
    assert.equal((await app.call("GET", "/api/news?kind=explainer")).body.items[0].id, b.id);
    assert.equal((await app.call("GET", "/api/news?q=iasworld")).body.total, 1, "keywords are searchable");
    assert.equal((await app.call("GET", `/api/news?series=${series.body.slug}`)).body.total, 1);
    const page = await app.call("GET", `/api/series/${series.body.slug}`);
    assert.equal(page.body.items[0].series_order, 1);
    const draftSeries = await app.call("POST", "/api/series", { user: owner, body: { title: "Unreleased series" } });
    assert.equal((await app.call("GET", `/api/series/${draftSeries.body.slug}`)).status, 404, "draft series hidden");
    assert.equal((await app.call("POST", "/api/series", { user: await app.user("contributor"), body: { title: "Nope" } })).status, 403);
  });

  test("source documents, verified sources and related stories", async () => {
    const app = createApp();
    const owner = await app.user("owner");
    const researcher = await app.user("researcher");
    const doc = await app.call("POST", "/api/records", { user: researcher, body: { title: "Board minutes 2016", jurisdiction_id: "ga-baldwin", record_date: "2016-02-16", source_url: "https://example.gov/minutes.pdf" } });
    const staffDoc = await app.call("POST", "/api/records", { user: researcher, body: { title: "Internal working notes", visibility: "staff" } });
    const form = new FormData();
    form.set("file", new Blob([PDF_BYTES], { type: "application/pdf" }), "minutes.pdf");
    assert.equal((await app.call("POST", `/api/records/${doc.body.id}/file`, { user: researcher, form })).status, 201);
    const a = await story(app, owner);
    const b = await story(app, owner, { title: "A second related story" });
    for (const target of [doc.body.id, staffDoc.body.id]) assert.equal((await app.call("POST", "/api/links", { user: owner, body: { source_type: "article", source_id: a.id, target_type: "document", target_id: target, relationship: "evidence" } })).status, 201);
    assert.equal((await app.call("POST", "/api/links", { user: owner, body: { source_type: "article", source_id: a.id, target_type: "article", target_id: b.id, relationship: "related" } })).status, 201);
    const cite = await app.call("POST", "/api/citations", { user: owner, body: { subject_type: "article", subject_id: a.id, label: "Minutes", document_id: doc.body.id, pinpoint: "PDF page 2" } });
    assert.equal((await app.call("POST", `/api/citations/${cite.body.id}/verify`, { user: researcher, body: {} })).status, 403, "only editors mark sources checked");
    assert.equal((await app.call("POST", `/api/citations/${cite.body.id}/verify`, { user: owner, body: {} })).status, 200);
    for (const s of [a, b]) await app.call("POST", `/api/news/${s.id}/review`, { user: owner, body: { decision: "publish" } });
    const pub = await app.call("GET", `/api/news/${a.slug}`);
    assert.deepEqual(pub.body.documents.map((d: { id: string }) => d.id), [doc.body.id], "staff-only records are not listed publicly");
    assert.equal(pub.body.documents[0].has_file, true);
    assert.ok(pub.body.citations[0].verified_at);
    assert.equal(pub.body.relatedStories[0].id, b.id);
    const staff = await app.call("GET", `/api/news/${a.slug}`, { user: researcher });
    assert.equal(staff.body.documents.length, 2);
  });

  test("cover images: alt text required, deduplicated by SHA-256, private until the story is published", async () => {
    const app = createApp();
    const owner = await app.user("owner");
    const upload = (alt: string) => { const f = new FormData(); f.set("file", new Blob([PNG], { type: "image/png" }), "cover.png"); f.set("alt_text", alt); f.set("is_illustration", "true"); return app.call("POST", "/api/media", { user: owner, form: f }); };
    assert.equal((await upload("x")).status, 422);
    const m = await upload("Symbolic illustration of an empty hearing room");
    assert.equal(m.status, 201);
    assert.equal(m.body.width, 1);
    assert.equal((await upload("Same image uploaded twice")).body.duplicate, true);
    const pdf = new FormData(); pdf.set("file", new Blob([PDF_BYTES], { type: "application/pdf" }), "x.pdf"); pdf.set("alt_text", "Not an image file at all");
    assert.equal((await app.call("POST", "/api/media", { user: owner, form: pdf })).status, 415);
    assert.equal((await app.call("POST", "/api/media", { user: await app.user("member"), form: pdf })).status, 403);
    const s = await story(app, owner, { hero_media_id: m.body.id });
    assert.equal((await app.call("GET", `/api/media/${m.body.id}/file`)).status, 404, "unpublished cover is private");
    assert.equal((await app.call("GET", `/api/media/${m.body.id}/file`, { user: owner })).status, 200);
    await app.call("POST", `/api/news/${s.id}/review`, { user: owner, body: { decision: "publish" } });
    const pub = await app.call("GET", `/api/media/${m.body.id}/file`);
    assert.equal(pub.status, 200);
    assert.equal(pub.headers.get("content-type"), "image/png");
    const art = await app.call("GET", `/api/news/${s.slug}`);
    assert.equal(art.body.article.hero_url, `/api/media/${m.body.id}/file`);
    assert.equal(art.body.article.hero_is_illustration, true);
    assert.deepEqual(imageSize(PNG), { width: 1, height: 1 });
  });

  test("share cards, canonical URLs, sitemap and robots", async () => {
    const app = createApp();
    const owner = await app.user("owner");
    const s = await story(app, owner, { seo_description: "Hearing <coverage> & documents" });
    const url = (p: string) => new URL("https://forge.test" + p);
    assert.equal((await pageMetaFor(app.env, url(`/news/${s.slug}`)))?.noindex, true, "drafts are not described to crawlers");
    await app.call("POST", `/api/news/${s.id}/review`, { user: owner, body: { decision: "publish" } });
    const meta = (await pageMetaFor(app.env, url(`/news/${s.slug}/`)))!;
    assert.equal(meta.canonical, `https://forge.test/news/${s.slug}`);
    const html = injectMeta("<html><head><title>x</title><meta name=\"description\" content=\"d\"><meta property=\"og:title\" content=\"o\"></head></html>", meta);
    assert.match(html, /<link rel="canonical" href="https:\/\/forge.test\/news\//);
    assert.match(html, /Hearing &lt;coverage&gt; &amp; documents/, "metadata is escaped");
    assert.equal((html.match(/<title>/g) || []).length, 1);
    assert.match(html, /application\/ld\+json/);
    const xml = await (await sitemap(app.env, "https://forge.test")).text();
    assert.match(xml, new RegExp(`/news/${s.slug}`));
    assert.match(await robots("https://forge.test", app.env).text(), /Disallow: \//, "non-production is not indexable");
    assert.match(await robots("https://forge.test", { ...app.env, APP_ENV: "production" }).text(), /Sitemap:/);
  });
});

describe("legacy import", () => {
  const manuscript = [
    "# Original headline", "", "November 6, 2026  ", "Baldwin Minute Watch", "", "Opening paragraph.", "",
    "October 2, 2012 minutes, PDF pages 1–2:  ", "https://baldwin-minute-watch-v21.otiseduncan.workers.dev/document?id=doc-a", "",
    "The complete recording is available here:  ", "https://baldwin-minute-watch-v21.otiseduncan.workers.dev/document?id=rec-playback_copy", "",
    "Closing line.", "", "Baldwin Minute Watch  ", "Debate the issue. Bring the documents.", "",
  ].join("\n");

  test("transform changes formatting only and records every edit", () => {
    const { body, edits } = transform("keim", manuscript, { migratedDocs: new Set(["doc-a"]), recordingUrl: "https://www.youtube.com/live/X" });
    assert.ok(!body.includes("Baldwin Minute Watch"), "legacy branding removed from the body");
    assert.match(body, /\[October 2, 2012 minutes, PDF pages 1–2\]\(\/records\/doc-a\)/);
    assert.match(body, /\(https:\/\/www.youtube.com\/live\/X\)/);
    assert.match(body, /^Opening paragraph\./);
    assert.match(body, /Closing line\.\n$/);
    assert.equal(edits.length, 5);
  });

  test("hash mismatches are refused, placeholders are marked, SQL is idempotent", async () => {
    const files: Record<string, Buffer> = { "m.md": Buffer.from(manuscript), "a.pdf": Buffer.from(PDF_BYTES) };
    const inv = {
      series: [{ id: "s1", slug: "s1", title: "Series", description: null, kind: "investigation", jurisdiction_id: "ga-baldwin", status: "draft" }],
      documents: [{ id: "doc-a", title: "Minutes", category_id: "minutes", document_type: "minutes", record_date: "2012-10-02", file: "a.pdf", sha256: sha256(files["a.pdf"]), source_url: "https://example.gov/a", summary: "s" }],
      stories: [
        { ref: "r1", decision: "import", title: "Imported story headline", kind: "investigation", series: "s1", tags: ["T"], documents: ["doc-a"], manuscript: { file: "m.md", sha256: sha256(files["m.md"]), transform: "keim" }, manuscript_state: "needs_evidence",
          citations: [{ label: "Minutes", document_id: "doc-a", pinpoint: "p1" }, { label: "Missing doc", document_id: "doc-missing" }] },
        { ref: "r2", decision: "placeholder", lead: "An essay lead", kind: "personal_essay", category_id: "essays", related: "Not found." },
      ],
    };
    const io = { readFile: (p: string) => files[p.split(/[\\/]/).pop()!], exists: (p: string) => !!files[p.split(/[\\/]/).pop()!] };
    const bad = buildPlan({ ...inv, documents: [{ ...inv.documents[0], sha256: "0".repeat(64) }] }, "/root", io);
    assert.match(bad.problems[0], /SHA-256 mismatch/);
    const plan = buildPlan(inv, "/root", io);
    assert.deepEqual(plan.problems, []);
    const app = createApp();
    await app.user("owner");
    const sqlText = planToSql(inv, plan, "2026-11-15T00:00:00.000Z");
    app.d1.db.exec(sqlText);
    app.d1.db.exec(sqlText);
    const rows = app.d1.db.prepare("SELECT legacy_ref, status, manuscript_state, author_id IS NOT NULL AS has_author FROM articles ORDER BY legacy_ref").all();
    assert.deepEqual(rows.map((r) => [r.legacy_ref, r.status, r.manuscript_state, r.has_author]), [["r1", "draft", "needs_evidence", 1], ["r2", "draft", "needs_manuscript", 1]]);
    assert.equal(app.d1.db.prepare("SELECT COUNT(*) AS n FROM documents").get()!.n, 1, "no duplicate records on re-run");
    assert.equal(app.d1.db.prepare("SELECT COUNT(*) AS n FROM citations").get()!.n, 1, "citations to unmigrated records are skipped");
    assert.equal(app.d1.db.prepare("SELECT COUNT(*) AS n FROM article_versions").get()!.n, 2);
    const placeholder = app.d1.db.prepare("SELECT body FROM articles WHERE legacy_ref = 'r2'").get()!.body as string;
    assert.match(placeholder, /NEEDS ORIGINAL MANUSCRIPT/);
    assert.equal((await app.call("GET", "/api/news")).body.total, 0, "nothing imported is public");
    assert.equal(stableId("article", "r1"), stableId("article", "r1"));
  });
});
