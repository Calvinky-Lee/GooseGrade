/**
 * QA tier 2 — the adversarial LLM cross-check (specs/07 §7, design decision D4).
 *
 * Tier 1 (deterministic invariants over every course) runs in CI, because it is milliseconds of
 * pure engine per course. THIS tier is the containerized one: it reads the stored outline back
 * against the parsed scheme and tries to find a disagreement, which costs a model call per
 * course and therefore wants sharding and retry.
 *
 * It only ever DOWNGRADES confidence. A model saying "looks right" is not evidence enough to
 * promote a course to `verified` — that would let a second model's optimism override the
 * deterministic gate.
 */

import Anthropic from '@anthropic-ai/sdk';

import { db, finishRun, startRun } from './db';
import { partition, resolveShard } from './shard';

const REVIEW_MODEL = 'claude-opus-5';

const CROSS_CHECK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    agrees: { type: 'boolean' },
    disagreements: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          field: { type: 'string' },
          expected: { type: 'string' },
          found: { type: 'string' },
          severity: { type: 'string', enum: ['warn', 'violation'] },
        },
        required: ['field', 'expected', 'found', 'severity'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['agrees', 'disagreements', 'summary'],
} as const;

const PROMPT = `You are auditing a parsed grading scheme against the course outline it came from.

You will be given the outline text and the parsed scheme as JSON. Decide whether the parse is
faithful to the outline.

Report a disagreement when:
  - a weight in the scheme does not match the outline
  - an assessment in the outline is missing from the scheme, or vice versa
  - a conditional rule in the outline (best-N-of-M, replacement, pass gate, redistribution) is
    missing from the scheme, or a rule in the scheme is not supported by the outline
  - the scheme's weights do not sum to 100 while the outline's clearly do

Severity: use "violation" only where a student's computed grade would actually differ. Naming,
ordering, and formatting differences are "warn" at most.

Do not report a disagreement you are unsure about. A false alarm sends a correct course to manual
review, which costs trust in the flag.`;

interface Row {
  id: string;
  code: string;
  section: string | null;
  scheme_confidence: string;
  grading_rules: unknown;
  outline_storage_path: string | null;
}

export interface QaLlmOptions {
  term?: string;
  /** By default only courses that have not been confirmed — the expensive tier is targeted. */
  all?: boolean;
  limit?: number;
  dryRun?: boolean;
}

export async function runLlmQa(opts: QaLlmOptions) {
  const shard = resolveShard();
  const runId = await startRun({
    kind: 'qa',
    term: opts.term ?? null,
    shardIndex: shard.index,
    shardCount: shard.count,
    model: REVIEW_MODEL,
  });

  let query = db()
    .from('catalog_courses')
    .select('id, code, section, scheme_confidence, grading_rules, outline_storage_path')
    .not('outline_storage_path', 'is', null);

  if (opts.term) query = query.eq('term', opts.term);
  // Targeted by default: re-auditing a verified course spends money to learn nothing.
  if (!opts.all) query = query.in('scheme_confidence', ['unconfirmed', 'review']);

  const listed = await query.order('code');
  if (listed.error) throw new Error(listed.error.message);

  let courses = partition((listed.data ?? []) as Row[], shard);
  if (opts.limit) courses = courses.slice(0, opts.limit);

  console.log(
    `[qa-llm] ${courses.length} courses in shard ${shard.index + 1}/${shard.count} (${shard.source})`,
  );

  const client = new Anthropic();
  const totals = {
    coursesSeen: 0,
    coursesWritten: 0,
    coursesSkipped: 0,
    coursesFailed: 0,
    inputTokens: 0,
    outputTokens: 0,
  };

  for (const course of courses) {
    totals.coursesSeen += 1;
    const tag = `${course.code}${course.section ? ` (${course.section})` : ''}`;

    try {
      const download = await db().storage.from('outlines').download(course.outline_storage_path!);
      if (download.error) {
        totals.coursesSkipped += 1;
        console.warn(`  ? ${tag} no stored outline`);
        continue;
      }
      const outlineText = await download.data.text();

      const assessments = await db()
        .from('catalog_assessments')
        .select('slug, name, category, weight, order_index')
        .eq('course_id', course.id);

      const scheme = {
        assessments: assessments.data ?? [],
        rules: course.grading_rules ?? [],
      };

      const message = await client.messages.create({
        model: REVIEW_MODEL,
        max_tokens: 8_000,
        thinking: { type: 'adaptive' },
        output_config: {
          effort: 'high',
          format: { type: 'json_schema', schema: CROSS_CHECK_SCHEMA },
        },
        messages: [
          {
            role: 'user',
            content: `${PROMPT}\n\nPARSED SCHEME:\n${JSON.stringify(
              scheme,
              null,
              2,
            )}\n\nOUTLINE:\n----------------\n${outlineText.slice(0, 100_000)}\n----------------`,
          },
        ],
      });

      totals.inputTokens += message.usage.input_tokens;
      totals.outputTokens += message.usage.output_tokens;

      const text = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      const verdict = JSON.parse(text) as {
        agrees: boolean;
        disagreements: Array<{
          field: string;
          expected: string;
          found: string;
          severity: 'warn' | 'violation';
        }>;
        summary: string;
      };

      const violations = verdict.disagreements.filter((d) => d.severity === 'violation');

      if (opts.dryRun) {
        console.log(
          `  ~ ${tag} [dry-run] agrees=${verdict.agrees} ` +
            `${verdict.disagreements.length} disagreement(s)`,
        );
        continue;
      }

      if (verdict.disagreements.length > 0) {
        await db().from('qa_findings').insert(
          verdict.disagreements.map((d) => ({
            catalog_course_id: course.id,
            scrape_run_id: runId,
            tier: 'llm' as const,
            severity: d.severity,
            invariant: `llm_disagreement:${d.field}`,
            detail: { ...d, summary: verdict.summary, model: REVIEW_MODEL },
          })),
        );
      }

      // Downgrade only. A cross-check cannot promote a course, because one model's confidence
      // is not evidence against the deterministic gate.
      if (violations.length > 0 && course.scheme_confidence !== 'review') {
        await db()
          .from('catalog_courses')
          .update({ scheme_confidence: 'review' })
          .eq('id', course.id);
        totals.coursesWritten += 1;
        console.log(`  ↓ ${tag} → review: ${violations.map((v) => v.field).join(', ')}`);
      } else {
        console.log(`  ✓ ${tag} no blocking disagreement`);
      }
    } catch (error) {
      totals.coursesFailed += 1;
      console.warn(`  ! ${tag} ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await finishRun(runId, totals);
  console.log(
    `[qa-llm] done: ${totals.coursesWritten} downgraded, ${totals.coursesFailed} failed · ` +
      `${totals.inputTokens} in / ${totals.outputTokens} out tokens`,
  );
  return totals;
}
