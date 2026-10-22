import { test } from "node:test";
import assert from "node:assert/strict";
import { termInfo } from "../lib/catalog/terms";
import { parseOfferings, validateScheme } from "../scripts/import/validation";

test("term validation is explicit and chronological", () => {
  assert.deepEqual(termInfo(1271), {
    id: 1271,
    label: "Winter 2027",
    date: "2027-01-01",
  });
  assert.throws(() => termInfo(1272));
});
test("offering parser rejects wrong term and empty pages, deduplicates codes", () => {
  const html =
    "<h1>Winter 2027 (1271)</h1><table><tr><td>CS</td><td>135</td><td>Designing Programs</td><td></td><td>UW</td></tr><tr><td>CS</td><td>135</td><td>Designing Programs</td><td></td><td>ONLN</td></tr></table>";
  assert.equal(parseOfferings(html, 1271).length, 1);
  assert.equal(parseOfferings(html, 1271)[0].name, "Designing Programs");
  assert.throws(() => parseOfferings(html, 1269));
  assert.throws(() => parseOfferings("Winter 2027 (1271)", 1271));
});
const scheme = (weights: number[]) => ({
  complete: true,
  conditional: false,
  notes: [],
  assessments: weights.map((weight, i) => ({
    slug: `item-${i}`,
    name: `Item ${i}`,
    category: "Other",
    weight,
    evidence: `Item ${i}: ${weight}%`,
    group: "",
    groupTotal: null,
  })),
});
test("only complete source-backed fixed schemes are accepted", () => {
  const s = scheme([20, 30, 50]);
  assert.equal(
    validateScheme(s, s.assessments.map((a) => a.evidence).join("\n")).status,
    "ready",
  );
  assert.equal(validateScheme(s, "missing evidence").status, "review");
  assert.equal(
    validateScheme({ ...s, conditional: true }, "").status,
    "review",
  );
  const bad = scheme([20, 30]);
  assert.equal(
    validateScheme(bad, bad.assessments.map((a) => a.evidence).join("\n"))
      .status,
    "review",
  );
});
test("rounding correction sums exactly at database precision; raw weights retained", () => {
  const s = scheme([33.33, 33.33, 33.33]);
  const r = validateScheme(s, s.assessments.map((a) => a.evidence).join("\n"));
  assert.equal(r.status, "ready");
  assert.equal(
    r.assessments.reduce((s, a) => s + BigInt(a.weight.replace(".", "")), 0n),
    1000000000000n,
  );
  assert.equal(r.assessments[0].raw_weight, 33.33);
});
test("duplicates, fabricated weights and invalid numbers require review", () => {
  const s = scheme([50, 50]);
  s.assessments[1].name = s.assessments[0].name;
  assert.equal(
    validateScheme(s, s.assessments.map((a) => a.evidence).join("\n")).status,
    "review",
  );
  const bad = scheme([40, 60]);
  bad.assessments[0].evidence = "Item 0: 20%";
  assert.equal(
    validateScheme(bad, bad.assessments.map((a) => a.evidence).join("\n"))
      .status,
    "review",
  );
});
test("group totals cannot change exact source weights without evidence", () => {
  const s = scheme([50, 50]);
  s.assessments[0].group = "Quiz";
  (s.assessments[0] as any).groupTotal = 50.04;
  assert.equal(validateScheme(s, "Item 0: 50% Item 1: 50%").status, "review");
});
test("source-verified groups preserve their own totals", () => {
  const s = scheme([16.67, 16.67, 16.67, 50]);
  for (let i = 0; i < 3; i++) {
    s.assessments[i].group = "Quizzes";
    (s.assessments[i] as any).groupTotal = 50;
  }
  const r = validateScheme(
    s,
    "Quizzes 50% " + s.assessments.map((a) => a.evidence).join(" "),
  );
  assert.equal(r.status, "ready");
  assert.equal(r.assessments[3].weight, "50.0000000000");
  assert.equal(
    r.assessments
      .slice(0, 3)
      .reduce((n, a) => n + BigInt(a.weight.replace(".", "")), 0n),
    500000000000n,
  );
});
