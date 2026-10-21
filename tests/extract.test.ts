import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTable } from "../scripts/import/extract";
test("exam pass gates prevent automatic fixed-scheme publication", () => {
  const html =
    "<body><table><tr><td>Assignments</td><td>50%</td></tr><tr><td>Final</td><td>50%</td></tr></table><p>You must earn at least 50% on the final exam to pass the course.</p></body>";
  assert.equal(extractTable(html), null);
});
