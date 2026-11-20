import { test } from "node:test";
import assert from "node:assert/strict";
import { legacyEvidence } from "../src/lib/legacy.ts";
import { legacyRecordPath } from "../public/js/core/legacy-link.js";
import type { Env } from "../src/env.ts";
import { errorResponse } from "../src/lib/http.ts";
import worker from "../src/index.ts";

test("both www hostnames redirect to HTTPS apex while preserving evidence paths and query strings", async () => {
  for (const domain of ["baldwinminutewatch.com", "baldwinminutewatch.org"]) {
    const response = await worker.fetch(new Request(`http://www.${domain}/records/legacy-id?download=1`), {} as Env, {} as ExecutionContext);
    assert.equal(response.status, 308);
    assert.equal(response.headers.get("location"), `https://${domain}/records/legacy-id?download=1`);
    const httpApex = await worker.fetch(new Request(`http://${domain}/records/legacy-id?download=1`), {} as Env, {} as ExecutionContext);
    assert.equal(httpApex.status, 308);
    assert.equal(httpApex.headers.get("location"), `https://${domain}/records/legacy-id?download=1`);
  }
});

test("D1 overload returns a retryable service response without exposing database errors", async () => {
  const res = errorResponse(new Error("D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window."));
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("retry-after"), "10");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.doesNotMatch(await res.text(), /D1_ERROR|SQLITE/);
});

test("legacy hash and document links retain record IDs and page references", () => {
  assert.equal(legacyRecordPath("/", "", "#/record/county-legacy-123?p=7"), "/legacy/records/county-legacy-123#page=7");
  assert.equal(legacyRecordPath("/document", "?id=a%20b", "#page=3"), "/legacy/records/a%20b#page=3");
  assert.equal(legacyRecordPath("/news/story", "", "#sources"), null);
  assert.equal(legacyRecordPath("/", "", "#/record/%ZZ"), null);
  assert.equal(legacyRecordPath("/", "", "#/forum/T-123"), "/legacy/community/T-123");
  assert.equal(legacyRecordPath("/", "", "#/project/abc"), "/legacy-map#/project/abc");
});

test("legacy compatibility preserves paths, range requests and missing-record responses without credentials", async () => {
  const calls: Request[] = [];
  const env = { LEGACY_RECORDS: { fetch: async (r: Request) => { calls.push(r); return new Response("Missing record", { status: 404, headers: { "set-cookie": "bad=value" } }); } } } as unknown as Env;
  for (const [path, upstream] of [["/civic-api/archive/documents/abc", "/api/archive/documents/abc"], ["/civic-files/documents/a.pdf", "/documents/a.pdf"], ["/api/archive/files/abc", "/api/archive/files/abc"]]) {
    const result = await legacyEvidence(new Request("https://site.test" + path + "?download=1", { headers: { cookie: "session=private", authorization: "secret", range: "bytes=0-9" } }), env);
    assert.equal(result?.status, 404);
    assert.equal(result?.headers.get("set-cookie"), null);
    const call = calls.at(-1)!;
    assert.equal(new URL(call.url).pathname, upstream);
    assert.equal(new URL(call.url).search, "?download=1");
    assert.equal(call.headers.get("range"), "bytes=0-9");
    assert.equal(call.headers.get("cookie"), null);
    assert.equal(call.headers.get("authorization"), null);
  }
  assert.equal((await legacyEvidence(new Request("https://site.test/civic-api/archive/files/abc", { method: "POST" }), env))?.status, 405);
  assert.equal(calls.length, 3);
  assert.equal((await legacyEvidence(new Request("https://site.test/documents/a.pdf"), {} as Env))?.status, 503);
  assert.equal(await legacyEvidence(new Request("https://site.test/api/records"), env), null);
});
