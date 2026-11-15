import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./harness.ts";

async function seedThread(app: ReturnType<typeof createApp>) {
  const alice = await app.user("member", "Alice");
  const bob = await app.user("member", "Bob");
  const d = await app.call("POST", "/api/forum/discussions", { user: alice, body: { title: "Paving schedule questions", body: "When is Main Street scheduled for resurfacing?", category_id: "roads-infrastructure" } });
  assert.equal(d.status, 201);
  return { alice, bob, id: d.body.id as string };
}

describe("community forum", () => {
  test("forum is free and public to read; posting requires a free account", async () => {
    const app = createApp();
    const cats = await app.call("GET", "/api/forum/categories");
    assert.equal(cats.status, 200);
    assert.ok(cats.body.items.length >= 5);
    assert.equal((await app.call("POST", "/api/forum/discussions", { body: { title: "Anonymous", body: "Should be refused" } })).status, 401);
    const { id } = await seedThread(app);
    const anonRead = await app.call("GET", `/api/forum/discussions/${id}`);
    assert.equal(anonRead.status, 200);
    assert.equal(anonRead.body.permissions.comment, false);
    assert.equal((await app.call("GET", "/api/forum/discussions?category=roads-infrastructure")).body.total, 1);
  });

  test("threaded replies, notifications and follows", async () => {
    const app = createApp();
    const { alice, bob, id } = await seedThread(app);
    const c1 = await app.call("POST", `/api/forum/discussions/${id}/comments`, { user: bob, body: { body: "The agenda for next week lists it." } });
    assert.equal(c1.status, 201);
    const reply = await app.call("POST", `/api/forum/discussions/${id}/comments`, { user: alice, body: { body: "Thanks — can you link the agenda?", parent_id: c1.body.id } });
    assert.equal(reply.status, 201);
    const thread = await app.call("GET", `/api/forum/discussions/${id}`, { user: bob });
    assert.equal(thread.body.comments.length, 2);
    assert.equal(thread.body.comments[1].parent_id, c1.body.id);
    assert.equal(thread.body.discussion.comment_count, 2);
    assert.equal(thread.body.following, true, "commenting follows the discussion");
    const aliceNotes = await app.call("GET", "/api/notifications", { user: alice });
    assert.equal(aliceNotes.body.items.length, 1);
    assert.match(aliceNotes.body.items[0].message, /Bob commented/);
    const bobNotes = await app.call("GET", "/api/notifications", { user: bob });
    assert.match(bobNotes.body.items[0].message, /Alice replied/);
    assert.equal((await app.call("POST", "/api/notifications/read", { user: bob, body: {} })).status, 200);
    assert.equal((await app.call("GET", "/api/me", { user: bob })).body.unreadNotifications, 0);
    // Reply to a comment in another thread is refused
    const other = await app.call("POST", "/api/forum/discussions", { user: bob, body: { title: "A second discussion", body: "Different topic entirely here.", category_id: "general" } });
    assert.equal((await app.call("POST", `/api/forum/discussions/${other.body.id}/comments`, { user: bob, body: { body: "cross", parent_id: c1.body.id } })).status, 422);
  });

  test("pagination of top-level comments keeps reply trees together", async () => {
    const app = createApp();
    const { alice, id } = await seedThread(app);
    const posters = [alice];
    for (let i = 0; i < 4; i++) posters.push(await app.user("member"));
    for (let i = 0; i < 4; i++) {
      const top = await app.call("POST", `/api/forum/discussions/${id}/comments`, { user: posters[i], body: { body: `Top level comment ${i}` } });
      await app.call("POST", `/api/forum/discussions/${id}/comments`, { user: posters[i + 1], body: { body: `Reply to ${i}`, parent_id: top.body.id } });
    }
    const page1 = await app.call("GET", `/api/forum/discussions/${id}?pageSize=2&page=1`);
    assert.equal(page1.body.total, 4);
    assert.equal(page1.body.comments.length, 4);
    const page2 = await app.call("GET", `/api/forum/discussions/${id}?pageSize=2&page=2`);
    assert.deepEqual(page2.body.comments.filter((c: { parent_id: string | null }) => !c.parent_id).map((c: { body: string }) => c.body), ["Top level comment 2", "Top level comment 3"]);
  });

  test("article, record and map discussions attach to existing content only", async () => {
    const app = createApp();
    const u = await app.user("member");
    assert.equal((await app.call("POST", "/api/forum/discussions", { user: u, body: { title: "About the 14th Amendment", body: "Discussion of due process.", context_type: "legal", context_id: "amendment-14" } })).status, 201);
    assert.equal((await app.call("POST", "/api/forum/discussions", { user: u, body: { title: "About nothing at all", body: "This context does not exist.", context_type: "document", context_id: "missing" } })).status, 404);
    const list = await app.call("GET", "/api/forum/discussions?context_type=legal&context_id=amendment-14");
    assert.equal(list.body.items[0].context.title, "Fourteenth Amendment — Citizenship, Due Process, Equal Protection");
    assert.equal((await app.call("GET", "/api/law/amendment-14")).body.discussions.length, 1);
  });

  test("moderation: reports, hide with public reason, transparency log, lock", async () => {
    const app = createApp();
    const { alice, bob, id } = await seedThread(app);
    const mod = await app.user("editor");
    const c = await app.call("POST", `/api/forum/discussions/${id}/comments`, { user: bob, body: { body: "Abusive content example" } });
    assert.equal((await app.call("POST", "/api/reports", { user: alice, body: { target_type: "comment", target_id: c.body.id, reason: "harassment" } })).status, 201);
    assert.equal((await app.call("POST", "/api/reports", { user: alice, body: { target_type: "comment", target_id: c.body.id, reason: "harassment" } })).status, 409);
    assert.equal((await app.call("GET", "/api/moderation/queue", { user: alice })).status, 403);
    const queue = await app.call("GET", "/api/moderation/queue", { user: mod });
    assert.equal(queue.body.reports[0].reports, 1);
    assert.equal((await app.call("POST", "/api/moderation/actions", { user: mod, body: { target_type: "comment", target_id: c.body.id, action: "hide" } })).status, 422, "reason required");
    assert.equal((await app.call("POST", "/api/moderation/actions", { user: mod, body: { target_type: "comment", target_id: c.body.id, action: "hide", reason: "Personal attack (rule 2)" } })).status, 200);
    const thread = await app.call("GET", `/api/forum/discussions/${id}`);
    const hidden = thread.body.comments.find((x: { id: string }) => x.id === c.body.id);
    assert.equal(hidden.body, null);
    assert.equal(hidden.removal_reason, "Personal attack (rule 2)");
    assert.equal(thread.body.discussion.comment_count, 0);
    const log = await app.call("GET", "/api/moderation/log");
    assert.equal(log.body.items[0].action, "hide");
    assert.equal(log.body.items[0].moderator_role, "editor");
    assert.equal(log.body.items[0].actor_id, undefined, "moderator identity not exposed");
    assert.equal((await app.call("GET", "/api/moderation/queue", { user: mod })).body.reports.length, 0);
    await app.call("POST", "/api/moderation/actions", { user: mod, body: { target_type: "discussion", target_id: id, action: "lock", reason: "Resolved" } });
    assert.equal((await app.call("POST", `/api/forum/discussions/${id}/comments`, { user: alice, body: { body: "after lock" } })).status, 423);
  });

  test("spam controls: duplicate posts, rate limits and link-heavy posts held for review", async () => {
    const app = createApp();
    const { bob, id } = await seedThread(app);
    assert.equal((await app.call("POST", `/api/forum/discussions/${id}/comments`, { user: bob, body: { body: "Same message" } })).status, 201);
    assert.equal((await app.call("POST", `/api/forum/discussions/${id}/comments`, { user: bob, body: { body: "Same message" } })).status, 409);
    const links = await app.call("POST", `/api/forum/discussions/${id}/comments`, { user: bob, body: { body: "https://a.x https://b.x https://c.x https://d.x https://e.x" } });
    assert.equal(links.body.moderation_state, "pending");
    const anon = await app.call("GET", `/api/forum/discussions/${id}`);
    assert.equal(anon.body.comments.find((c: { id: string }) => c.id === links.body.id).body, null, "pending content is not public");
    for (let i = 0; i < 8; i++) await app.call("POST", `/api/forum/discussions/${id}/comments`, { user: bob, body: { body: `Message ${i}` } });
    assert.equal((await app.call("POST", `/api/forum/discussions/${id}/comments`, { user: bob, body: { body: "One too many" } })).status, 429);
  });

  test("authors can edit and delete their own comments only", async () => {
    const app = createApp();
    const { alice, bob, id } = await seedThread(app);
    const c = await app.call("POST", `/api/forum/discussions/${id}/comments`, { user: bob, body: { body: "Original text" } });
    assert.equal((await app.call("PATCH", `/api/comments/${c.body.id}`, { user: alice, body: { body: "Hijack" } })).status, 403);
    assert.equal((await app.call("PATCH", `/api/comments/${c.body.id}`, { user: bob, body: { body: "Edited text" } })).status, 200);
    assert.equal((await app.call("DELETE", `/api/comments/${c.body.id}`, { user: bob })).status, 200);
    const t = await app.call("GET", `/api/forum/discussions/${id}`);
    assert.equal(t.body.comments[0].moderation_state, "deleted");
    assert.equal(t.body.comments[0].author, null);
  });

  test("turnstile is enforced when configured", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ success: false }))) as typeof fetch;
    try {
      const app = createApp({ TURNSTILE_SECRET_KEY: "secret" });
      const u = await app.user("member");
      const missing = await app.call("POST", "/api/forum/discussions", { user: u, body: { title: "Turnstile test", body: "Body of the post", category_id: "general" } });
      assert.equal(missing.status, 422);
      const failed = await app.call("POST", "/api/forum/discussions", { user: u, body: { title: "Turnstile test", body: "Body of the post", category_id: "general", turnstileToken: "bad" } });
      assert.equal(failed.status, 422);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
