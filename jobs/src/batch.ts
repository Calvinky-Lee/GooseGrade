/**
 * Message Batches path for the full-term scrape — specs/07 §6, B5 hook.
 *
 * WHY THIS EXISTS: Batch is 50% cheaper, and the model bill is ~150x the compute bill for a term
 * scrape. Doing one synchronous call per course therefore doubles the only cost that matters —
 * roughly $300 instead of $150 on Opus for ~1,600 courses. Batches complete within hours, which
 * is fine for a job that runs three times a year.
 *
 * Shape: submit → poll → ingest. Deliberately split into three phases so a submitted batch
 * survives the pod that submitted it. A container that dies mid-poll must not orphan a batch
 * that Anthropic is already processing and that we are already paying for, so the batch id is
 * persisted to scrape_runs and `--resume` picks it back up.
 */

import Anthropic from '@anthropic-ai/sdk';

import { db, finishRun, startRun } from './db';
import { DEFAULT_MODEL, EXTRACTION_PROMPT } from './extract';
import { fetchOutline, politeDelay, CookieExpiredError } from './fetch';
import { sanitizeScheme, validateAgainstEngine } from './sanitize';
import { GRADING_SCHEME_SCHEMA, zScheme } from './schema';
import { partition, resolveShard } from './shard';

/** Anthropic caps a batch at 100,000 requests / 256MB; outlines are large, so chunk well under. */
const MAX_REQUESTS_PER_BATCH = 250;
const POLL_INTERVAL_MS = 30_000;

export interface BatchOptions {
  term: string;
  model?: string;
  limit?: number;
  force?: boolean;
  /** Submit and exit without waiting — the batch is recorded so it can be ingested later. */
  submitOnly?: boolean;
  /** Ingest results for an already-submitted batch id. */
  resume?: string;
  dryRun?: boolean;
}

interface CatalogRow {
  id: string;
  code: string;
  section: string | null;
  outline_url: string | null;
  source_hash: string | null;
  grading_rules: unknown;
}

/**
 * custom_id must survive the round trip and be unique. Results arrive in ANY order, so this is
 * the only link back to the course — never position.
 */
const customId = (courseId: string) => `course_${courseId}`;
const courseIdFromCustom = (id: string) => id.replace(/^course_/, '');

export async function runBatch(opts: BatchOptions) {
  const shard = resolveShard();
  const model = opts.model ?? DEFAULT_MODEL;
  const client = new Anthropic();

  const runId = await startRun({
    kind: 'scrape',
    term: opts.term,
    shardIndex: shard.index,
    shardCount: shard.count,
    model,
  });

  const totals = {
    coursesSeen: 0,
    coursesWritten: 0,
    coursesSkipped: 0,
    coursesFailed: 0,
    inputTokens: 0,
    outputTokens: 0,
  };

  // ---- resume: skip straight to ingest -------------------------------------
  if (opts.resume) {
    console.log(`[batch] resuming ${opts.resume}`);
    await pollUntilDone(client, opts.resume);
    await ingest(client, opts.resume, totals, runId, model);
    await finishRun(runId, totals);
    return totals;
  }

  // ---- 1. gather outlines --------------------------------------------------
  const listed = await db()
    .from('catalog_courses')
    .select('id, code, section, outline_url, source_hash, grading_rules')
    .eq('term', opts.term)
    .not('outline_url', 'is', null)
    .order('code');
  if (listed.error) throw new Error(listed.error.message);

  let courses = partition((listed.data ?? []) as CatalogRow[], shard);
  if (opts.limit) courses = courses.slice(0, opts.limit);

  console.log(`[batch] ${courses.length} courses in shard ${shard.index + 1}/${shard.count}`);

  const requests: Anthropic.Messages.Batches.BatchCreateParams.Request[] = [];
  const fetched = new Map<string, { text: string; sourceHash: string; url: string }>();

  for (const course of courses) {
    totals.coursesSeen += 1;
    const tag = `${course.code}${course.section ? ` (${course.section})` : ''}`;
    try {
      await politeDelay();
      const outline = await fetchOutline(course.outline_url!);

      if (!opts.force && course.source_hash === outline.sourceHash) {
        totals.coursesSkipped += 1;
        continue;
      }

      fetched.set(course.id, outline);
      requests.push({
        custom_id: customId(course.id),
        params: {
          model,
          max_tokens: 16_000,
          thinking: { type: 'adaptive' },
          output_config: {
            effort: 'high',
            format: { type: 'json_schema', schema: GRADING_SCHEME_SCHEMA },
          },
          messages: [
            {
              role: 'user',
              content: `${EXTRACTION_PROMPT}\n\n----------------\n${outline.text.slice(
                0,
                100_000,
              )}\n----------------`,
            },
          ],
        },
      });
    } catch (error) {
      if (error instanceof CookieExpiredError) {
        await finishRun(runId, { ...totals, error: error.message });
        throw error;
      }
      totals.coursesFailed += 1;
      console.warn(`  ! ${tag} ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (requests.length === 0) {
    console.log('[batch] nothing to extract — every outline is unchanged.');
    await finishRun(runId, totals);
    return totals;
  }

  if (opts.dryRun) {
    console.log(`[batch] [dry-run] would submit ${requests.length} requests in ` +
      `${Math.ceil(requests.length / MAX_REQUESTS_PER_BATCH)} batch(es)`);
    await finishRun(runId, totals);
    return totals;
  }

  // ---- 2. submit ----------------------------------------------------------
  // Chunked because a batch is capped by both request count and total size, and 1,600 outlines
  // at ~100KB each would exceed the size limit in a single submission.
  const batchIds: string[] = [];
  for (let i = 0; i < requests.length; i += MAX_REQUESTS_PER_BATCH) {
    const chunk = requests.slice(i, i + MAX_REQUESTS_PER_BATCH);
    const batch = await client.messages.batches.create({ requests: chunk });
    batchIds.push(batch.id);
    console.log(`[batch] submitted ${batch.id} (${chunk.length} requests)`);
  }

  // Persisted before any polling: if this process dies now, the batch ids are recoverable and
  // `--resume` can ingest work we have already been charged for.
  await recordBatchIds(runId, batchIds);

  if (opts.submitOnly) {
    console.log(
      `[batch] submitted and exiting. Ingest later with:\n` +
        batchIds.map((id) => `  npm run batch -- --resume ${id}`).join('\n'),
    );
    await finishRun(runId, totals);
    return totals;
  }

  // ---- 3. poll and ingest -------------------------------------------------
  for (const id of batchIds) {
    await pollUntilDone(client, id);
    await ingest(client, id, totals, runId, model, fetched);
  }

  await finishRun(runId, totals);
  console.log(
    `[batch] done: ${totals.coursesWritten} written, ${totals.coursesSkipped} skipped, ` +
      `${totals.coursesFailed} failed · ${totals.inputTokens} in / ${totals.outputTokens} out`,
  );
  return totals;
}

async function recordBatchIds(runId: string | null, batchIds: string[]): Promise<void> {
  if (!runId) return;
  await db()
    .from('scrape_runs')
    .update({ error: `batch_ids=${batchIds.join(',')}` })
    .eq('id', runId);
}

async function pollUntilDone(client: Anthropic, batchId: string): Promise<void> {
  for (;;) {
    const batch = await client.messages.batches.retrieve(batchId);
    if (batch.processing_status === 'ended') return;
    console.log(
      `[batch] ${batchId} ${batch.processing_status} — ` +
        `${batch.request_counts.succeeded} ok / ${batch.request_counts.processing} processing`,
    );
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

async function ingest(
  client: Anthropic,
  batchId: string,
  totals: {
    coursesWritten: number;
    coursesFailed: number;
    inputTokens: number;
    outputTokens: number;
  },
  runId: string | null,
  model: string,
  fetched?: Map<string, { text: string; sourceHash: string; url: string }>,
): Promise<void> {
  for await (const result of await client.messages.batches.results(batchId)) {
    const courseId = courseIdFromCustom(result.custom_id);

    if (result.result.type !== 'succeeded') {
      totals.coursesFailed += 1;
      console.warn(`  ! ${result.custom_id} ${result.result.type}`);
      continue;
    }

    const message = result.result.message;
    totals.inputTokens += message.usage.input_tokens;
    totals.outputTokens += message.usage.output_tokens;

    try {
      const text = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');

      const parsed = zScheme.safeParse(JSON.parse(text));
      if (!parsed.success) throw new Error(`Zod: ${parsed.error.message}`);

      const course = await db()
        .from('catalog_courses')
        .select('id, code, section, source_hash, grading_rules')
        .eq('id', courseId)
        .single();
      if (course.error) throw new Error(course.error.message);

      const row = course.data as CatalogRow;
      const sanitized = sanitizeScheme(parsed.data, row.code);

      const gate = validateAgainstEngine(sanitized, row.code);
      if (!gate.ok) {
        sanitized.confidence = 'review';
        sanitized.notes.push(...gate.violations);
      }

      // On a --resume run the fetched map is gone (different process), so the stored hash is
      // left as-is rather than being invented. The next diff run will reconcile it.
      const outline = fetched?.get(courseId);
      await writeBatchResult(row, sanitized, outline, runId, model);

      totals.coursesWritten += 1;
      console.log(
        `  + ${row.code}${row.section ? ` (${row.section})` : ''} ` +
          `${sanitized.assessments.length} items, ${sanitized.rules.length} rules, ` +
          sanitized.confidence,
      );
    } catch (error) {
      totals.coursesFailed += 1;
      console.warn(
        `  ! ${result.custom_id} ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

async function writeBatchResult(
  course: CatalogRow,
  sanitized: ReturnType<typeof sanitizeScheme>,
  outline: { text: string; sourceHash: string; url: string } | undefined,
  runId: string | null,
  model: string,
): Promise<void> {
  const client = db();

  if (outline) {
    const storagePath = `${course.id}.txt`;
    const upload = await client.storage
      .from('outlines')
      .upload(storagePath, outline.text, { contentType: 'text/plain', upsert: true });

    await client
      .from('catalog_courses')
      .update({
        grading_rules: sanitized.rules,
        scheme_confidence: sanitized.confidence,
        outline_url: outline.url,
        outline_storage_path: upload.error ? null : storagePath,
        source_hash: outline.sourceHash,
        last_scraped: new Date().toISOString(),
      })
      .eq('id', course.id);
  } else {
    await client
      .from('catalog_courses')
      .update({
        grading_rules: sanitized.rules,
        scheme_confidence: sanitized.confidence,
        last_scraped: new Date().toISOString(),
      })
      .eq('id', course.id);
  }

  const rows = sanitized.assessments.map((a) => ({
    course_id: course.id,
    slug: a.slug,
    name: a.name,
    category: a.category,
    assessment_type: a.category,
    weight: a.weight,
    order_index: a.orderIndex,
    total_weight: a.weight,
  }));

  await client.from('catalog_assessments').upsert(rows, { onConflict: 'course_id,slug' });

  const keep = sanitized.assessments.map((a) => a.slug);
  await client
    .from('catalog_assessments')
    .delete()
    .eq('course_id', course.id)
    .not('slug', 'in', `(${keep.map((s) => `"${s}"`).join(',')})`);

  if (sanitized.notes.length > 0 && sanitized.confidence === 'review') {
    await client.from('qa_findings').insert(
      sanitized.notes.map((note) => ({
        catalog_course_id: course.id,
        scrape_run_id: runId,
        tier: 'llm' as const,
        severity: 'warn' as const,
        invariant: 'extraction_note',
        detail: { note, model, via: 'batch' },
      })),
    );
  }
}
