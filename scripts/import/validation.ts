import * as cheerio from "cheerio";
import { z } from "zod";
import { termInfo } from "../../lib/catalog/terms";
export const conditionalPattern =
  /\bpass\b|\bminimum\b|\bbest\b.{0,30}\bof\b|\bdrop(?:ped|ping)?\b.{0,30}\b(?:lowest|quiz|assignment)\b|\blowest\b.{0,30}\bdrop|\bbonus\b|\bhigher\s+of\b|\breplace(?:ment|s|d)?\b|\bre-?weight|\balternative\s+(?:grading|scheme)\b/i;
export const OFFERINGS_URL = "https://classes.uwaterloo.ca/uwpcshtm.html";
export function parseOfferings(html: string, term: number) {
  const $ = cheerio.load(html);
  const info = termInfo(term);
  const text = $("body").text();
  if (!text.includes(info.label) || !text.includes(String(term)))
    throw Error("Offering source does not match the requested term.");
  const map = new Map<
    string,
    {
      code: string;
      name: string;
      department: string;
      term_id: number;
      term: string;
      term_date: string;
      source_url: string;
      source_variants: string[];
      fetched_at: string;
    }
  >();
  $("table tr").each((_, el) => {
    const t = $(el).find("td");
    const s = $(t[0]).text().trim(),
      n = $(t[1]).text().trim();
    if (!/^[A-Z]+$/.test(s) || !/^\d+[A-Z]*$/.test(n)) return;
    const code = `${s} ${n}`;
    const variant = t
      .slice(2)
      .map((_, td) => $(td).text().trim())
      .get()
      .join(" | ");
    const row = map.get(code) || {
      code,
      name: $(t[2]).text().trim() || code,
      department: s,
      term_id: term,
      term: info.label,
      term_date: info.date,
      source_url: OFFERINGS_URL,
      source_variants: [],
      fetched_at: new Date().toISOString(),
    };
    if (!row.source_variants.includes(variant))
      row.source_variants.push(variant);
    map.set(code, row);
  });
  if (!map.size)
    throw Error("No offerings found. Existing catalog has been preserved.");
  return [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
}
export const extractionSchema = z.object({
  complete: z.boolean(),
  conditional: z.boolean(),
  notes: z.array(z.string()),
  assessments: z
    .array(
      z.object({
        slug: z.string().regex(/^[a-z0-9-]+$/),
        name: z.string().min(1),
        category: z.string(),
        weight: z.number().finite().min(0).max(100),
        evidence: z.string().min(1),
        group: z.string(),
        groupTotal: z.number().finite().min(0).max(100).nullable(),
      }),
    )
    .min(1),
});
export type Extraction = z.infer<typeof extractionSchema>;
export interface ValidatedItem {
  slug: string;
  name: string;
  category: string;
  weight: string;
  raw_weight: number;
  total_weight: string;
  group_name: string;
  source_evidence: string;
}
const units = 1000000000000n;
function allocate(weights: number[], total: bigint) {
  const raw = weights.map((w) => BigInt(Math.round(w * 1e10)));
  const sum = raw.reduce((a, b) => a + b, 0n);
  if (sum === 0n) return raw.map(() => 0n);
  const base = raw.map((w) => (w * total) / sum);
  let left = total - base.reduce((a, b) => a + b, 0n);
  const rank = raw
    .map((w, i) => ({ i, r: (w * total) % sum }))
    .sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (let i = 0; left > 0n; i++, left--) base[rank[i % rank.length].i]++;
  return base;
}
function decimal(n: bigint) {
  return `${n / 10000000000n}.${String(n % 10000000000n).padStart(10, "0")}`;
}
export function validateScheme(
  input: unknown,
  source: string,
): {
  status: "ready" | "review";
  reasons: string[];
  assessments: ValidatedItem[];
} {
  const parsed = extractionSchema.safeParse(input);
  if (!parsed.success)
    return {
      status: "review",
      reasons: ["Invalid extraction structure."],
      assessments: [],
    };
  const s = parsed.data,
    reasons: string[] = [];
  const normalized = source.replace(/\s+/g, " ").trim();
  if (!s.complete) reasons.push("Source scheme is incomplete.");
  if (s.conditional || conditionalPattern.test(source))
    reasons.push("Conditional grading needs review.");
  const names = new Set<string>(),
    slugs = new Set<string>();
  for (const a of s.assessments) {
    const name = a.name.toLowerCase().trim();
    if (names.has(name) || slugs.has(a.slug))
      reasons.push("Duplicate assessment identity.");
    names.add(name);
    slugs.add(a.slug);
    if (!normalized.includes(a.evidence.replace(/\s+/g, " ").trim()))
      reasons.push(`Missing source evidence: ${a.name}`);
    const percentages = [
      ...a.evidence.matchAll(/(\d+(?:\.\d+)?)\s*(?:%|percent)/gi),
    ].map((m) => Number(m[1]));
    if (!percentages.includes(a.weight))
      reasons.push(`Weight not explicit in evidence: ${a.name}`);
  }
  const total = s.assessments.reduce((sum, a) => sum + a.weight, 0);
  // Only decimal-rounded source items can justify rounding correction.
  const bound = s.assessments.reduce((sum, a) => {
    const match = a.evidence.match(
      new RegExp(
        `${String(a.weight).replace(".", "\\.")}\\s*(?:%|percent)`,
        "i",
      ),
    );
    const decimals = match?.[0].match(/\.(\d+)/)?.[1].length || 0;
    return sum + (decimals ? 0.5 * 10 ** -decimals : 0);
  }, 0);
  if (
    Math.abs(total - 100) > 0.05 + 1e-9 ||
    Math.abs(total - 100) > bound + 1e-9
  )
    reasons.push(`Source weights sum to ${total}%.`);
  const groups = new Map<string, { indices: number[]; total: number }>();
  s.assessments.forEach((a, i) => {
    if (a.group && a.groupTotal !== null) {
      const group = groups.get(a.group) || { indices: [], total: a.groupTotal };
      if (group.total !== a.groupTotal)
        reasons.push("Conflicting group totals.");
      group.indices.push(i);
      groups.set(a.group, group);
    }
  });
  for (const [name, g] of groups) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const evidence = normalized.match(
      new RegExp(
        escaped +
          "[^%]{0,100}?" +
          String(g.total).replace(".", "\\.") +
          "\\s*(?:%|percent)",
        "i",
      ),
    );
    if (!evidence) reasons.push("Group total lacks explicit source evidence.");
    const sum = g.indices.reduce((sum, i) => sum + s.assessments[i].weight, 0);
    const precisionBound = g.indices.reduce((sum, i) => {
      const a = s.assessments[i];
      const m = a.evidence.match(
        new RegExp(
          String(a.weight).replace(".", "\\.") + "\\s*(?:%|percent)",
          "i",
        ),
      );
      const d = m?.[0].match(/\.(\d+)/)?.[1].length || 0;
      return sum + (d ? 0.5 * 10 ** -d : 0);
    }, 0);
    if (Math.abs(sum - g.total) > Math.min(0.05, precisionBound) + 1e-9)
      reasons.push("Group weights disagree with source precision.");
  }
  if (reasons.length || total <= 0)
    return {
      status: "review",
      reasons: [...new Set(reasons)],
      assessments: [],
    };
  let weights = allocate(
    s.assessments.map((a) => a.weight),
    units,
  );
  if (groups.size) {
    const assigned = new Set<number>();
    let groupUnits = 0n;
    for (const g of groups.values()) {
      const u = BigInt(Math.round(g.total * 1e10));
      groupUnits += u;
      const w = allocate(
        g.indices.map((i) => s.assessments[i].weight),
        u,
      );
      g.indices.forEach((i, j) => {
        assigned.add(i);
        weights[i] = w[j];
      });
    }
    const free = s.assessments.map((_, i) => i).filter((i) => !assigned.has(i));
    if (groupUnits > units || (!free.length && groupUnits !== units))
      return {
        status: "review",
        reasons: ["Group totals do not form a complete scheme."],
        assessments: [],
      };
    const rest = allocate(
      free.map((i) => s.assessments[i].weight),
      units - groupUnits,
    );
    free.forEach((i, j) => (weights[i] = rest[j]));
  }
  if (weights.reduce((a, b) => a + b, 0n) !== units)
    return {
      status: "review",
      reasons: ["Cannot allocate rounding residual."],
      assessments: [],
    };
  return {
    status: "ready",
    reasons:
      Math.abs(total - 100) > 1e-9
        ? [`Corrected source rounding from ${total}%.`]
        : [],
    assessments: s.assessments.map((a, i) => ({
      slug: a.slug,
      name: a.name,
      category: a.category,
      weight: decimal(weights[i]),
      raw_weight: a.weight,
      total_weight:
        a.groupTotal === null ? decimal(weights[i]) : a.groupTotal.toFixed(10),
      group_name: a.group,
      source_evidence: a.evidence,
    })),
  };
}
