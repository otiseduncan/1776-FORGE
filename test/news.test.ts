import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./harness.ts";

const DRAFT = { title: "How the county spends road funds", summary: "A look at the documents.", body: "## Findings\n\nThe adopted budget allocates funds as described in the record.", category_id: "investigations", kind: "investigation", tags: ["Roads", "Budget"] };

describe("newsroom editorial workflow", () => {
  test("contributors draft privately; members cannot draft", async () => {
    const app = createApp();
    const member = await app.user("member");
    assert.equal((await app.call("POST", "/api/news", { user: member, body: DRAFT })).status, 403);
    const writer = await app.user("contributor");
    const created = await app.call("POST", "/api/news", { user: writer, body: DRAFT });
    assert.equal(created.status, 201);
    assert.equal(created.body.slug, "how-the-county-spends-road-funds");
    assert.equal((await app.call("GET", "/api/news")).body.total, 0, "drafts are not public");
    assert.equal((await app.call("GET", `/api/news/${created.body.slug}`)).status, 404);
    assert.equal((await app.call("GET", `/api/news/${created.body.slug}`, { user: writer })).status, 200);
    assert.equal((await app.call("POST", "/api/news", { user: writer, body: { ...DRAFT, video_url: "https://evil.example/video" } })).status, 422);
    const second = await app.call("POST", "/api/news", { user: writer, body: DRAFT });
    assert.equal(second.body.slug, "how-the-county-spends-road-funds-2");
  });

  test("submit → review → publish, with second-editor rule, versions, featuring and corrections", async () => {
    const app = createApp();
    const writer = await app.user("contributor", "Writer");
    const editor = await app.user("editor", "Editor");
    const reader = await app.user("member");
    const { body: { id, slug } } = await app.call("POST", "/api/news", { user: writer, body: DRAFT });
    assert.equal((await app.call("PATCH", `/api/news/${id}`, { user: writer, body: { body: DRAFT.body + "\n\nSecond paragraph added." } })).body.version, 2);
    assert.equal((await app.call("POST", `/api/news/${id}/review`, { user: writer, body: { decision: "publish" } })).status, 403);
    assert.equal((await app.call("POST", `/api/news/${id}/submit`, { user: writer })).status, 200);
    const notes = await app.call("GET", "/api/notifications", { user: editor });
    assert.match(notes.body.items[0].message, /submitted for editorial review/);
    assert.equal((await app.call("POST", `/api/news/${id}/review`, { user: editor, body: { decision: "return" } })).status, 422);
    assert.equal((await app.call("POST", `/api/news/${id}/review`, { user: editor, body: { decision: "return", note: "Cite the budget page." } })).body.status, "draft");
    await app.call("POST", `/api/news/${id}/submit`, { user: writer });
    assert.equal((await app.call("POST", `/api/news/${id}/review`, { user: editor, body: { decision: "publish" } })).body.status, "published");

    const pub = await app.call("GET", `/api/news/${slug}`);
    assert.equal(pub.status, 200);
    assert.deepEqual(pub.body.article.tags.sort(), ["Budget", "Roads"]);
    assert.equal(pub.body.article.author, "Writer");
    assert.equal((await app.call("GET", "/api/news?tag=roads")).body.total, 1);
    assert.equal((await app.call("GET", "/api/news?category=investigations")).body.total, 1);

    assert.equal((await app.call("PATCH", `/api/news/${id}`, { user: writer, body: { title: "Changed after publication" } })).status, 403, "authors cannot silently edit published work");
    assert.equal((await app.call("PATCH", `/api/news/${id}`, { user: editor, body: { title: "Changed after publication" } })).status, 422, "change note required");
    assert.equal((await app.call("PATCH", `/api/news/${id}`, { user: editor, body: { title: "How the county spends its road funds", change_note: "Headline clarity" } })).status, 200);
    const versions = await app.call("GET", `/api/news/${id}/versions`, { user: writer });
    assert.equal(versions.body.items.length, 3);
    assert.equal(versions.body.items[0].note, "Headline clarity");

    await app.call("POST", "/api/follows", { user: reader, body: { target_type: "article", target_id: id } });
    assert.equal((await app.call("POST", `/api/news/${id}/corrections`, { user: writer, body: { body: "Wrong" } })).status, 403);
    assert.equal((await app.call("POST", `/api/news/${id}/corrections`, { user: editor, body: { kind: "correction", body: "An earlier version misstated the fiscal year as 2023." } })).status, 201);
    assert.equal((await app.call("GET", `/api/news/${slug}`)).body.corrections.length, 1);
    assert.match((await app.call("GET", "/api/notifications", { user: reader })).body.items[0].message, /correction/);

    assert.equal((await app.call("POST", `/api/news/${id}/feature`, { user: editor, body: { featured: true } })).status, 200);
    const home = await app.call("GET", "/api/home");
    assert.equal(home.body.featured[0].slug, slug);
    const profile = await app.call("GET", `/api/authors/${writer.id}`);
    assert.equal(profile.body.articles.length, 1);
    assert.equal(profile.body.profile.email, undefined, "emails are never exposed on profiles");
  });

  test("an editor cannot publish their own article without a second reviewer", async () => {
    const app = createApp();
    const editor = await app.user("editor");
    const owner = await app.user("owner");
    const { body: { id } } = await app.call("POST", "/api/news", { user: editor, body: DRAFT });
    await app.call("POST", `/api/news/${id}/submit`, { user: editor });
    assert.equal((await app.call("POST", `/api/news/${id}/review`, { user: editor, body: { decision: "publish" } })).status, 403);
    assert.equal((await app.call("POST", `/api/news/${id}/review`, { user: owner, body: { decision: "publish" } })).status, 200);
  });

  test("workspace lists own drafts for contributors, all for editors", async () => {
    const app = createApp();
    const a = await app.user("contributor");
    const b = await app.user("contributor");
    const editor = await app.user("editor");
    await app.call("POST", "/api/news", { user: a, body: DRAFT });
    await app.call("POST", "/api/news", { user: b, body: { ...DRAFT, title: "Another investigation draft" } });
    assert.equal((await app.call("GET", "/api/workspace/articles", { user: a })).body.items.length, 1);
    assert.equal((await app.call("GET", "/api/workspace/articles", { user: editor })).body.items.length, 2);
  });
});
