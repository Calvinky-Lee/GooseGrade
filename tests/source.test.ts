import { test } from "node:test";
import assert from "node:assert/strict";
import { searchOutlines } from "../scripts/import/source";
test("search follows pages and filters term and course", async () => {
  let calls = 0;
  const request = async (url: string) => {
    calls++;
    return new Response(
      JSON.stringify(
        calls === 1
          ? {
              count: 3,
              next: "https://outline.uwaterloo.ca/api/search/?q=CS%20135&page=2",
              results: [{ term: 1269, title: "CS 135", url: "/view/1" }],
            }
          : {
              count: 3,
              next: null,
              results: [
                {
                  term: 1271,
                  title: "CS 135 - Designing Programs",
                  url: "/view/2",
                },
                { term: 1271, title: "CS 1350", url: "/view/3" },
              ],
            },
      ),
      { headers: { "content-type": "application/json" } },
    );
  };
  const r = await searchOutlines("CS 135", 1271, "cookie", request);
  assert.equal(calls, 2);
  assert.equal(r.length, 1);
  assert.equal(r[0].url, "https://outline.uwaterloo.ca/view/2");
});
test("authentication failures are fatal, not empty results", async () => {
  await assert.rejects(
    () =>
      searchOutlines(
        "CS 135",
        1271,
        "",
        async () => new Response("", { status: 403 }),
      ),
    /Authentication/,
  );
});
test("foreign pagination destinations cannot receive cookies", async () => {
  await assert.rejects(
    () =>
      searchOutlines(
        "CS 135",
        1271,
        "secret",
        async () =>
          new Response(
            JSON.stringify({ results: [], next: "https://example.com/" }),
            { headers: { "content-type": "application/json" } },
          ),
      ),
    /host/,
  );
});
