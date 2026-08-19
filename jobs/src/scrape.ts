/**
 * `scrape` and `diff` — specs/07 §3, §4.
 *
 * One code path for both: a scrape is a diff run that has no prior hash to compare against.
 * That keeps the source_hash skip and the diff recording from drifting apart.
 */

import { db, finishRun, startRun } from './db';
import { extractScheme, needsEscalation, DEFAULT_MODEL } from './extract';
import { fetchOutline, politeDelay, CookieExpiredError } from './fetch';
import { sanitizeScheme, validateAgainstEngine } from './sanitize';
import { partition, resolveShard } from './shard';

export interface ScrapeOptions {
  /** UW term code or label. Required — specs/07 §3 removes the hardcoded 1261. */
  term: string;
  /** Re-extract even when source_hash is unchanged. */
  force?: boolean;
  /** Cheap-tier first pass; escalation to Opus is decided deterministically. */
  cheapModel?: string;
  limit?: number;
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

export async function runScrape(opts: ScrapeOptions, kind: 'scrape' | 'rescrape') {
  const shard = resolveShard();
  const runId = await startRun({
    kind,
    term: opts.term,
    shardIndex: shard.index,
    shardCount: shard.count,
    model: opts.cheapModel ?? DEFAULT_MODEL,
  });

  console.log(
    `[${kind}] term=${opts.term} shard=${shard.index + 1}/${shard.count} (${shard.source})`,
  );

  const listed = await db()
    .from('catalog_courses')
    .select('id, code, section, outline_url, source_hash, grading_rules')
    .eq('term', opts.term)
    .not('outline_url', 'is', null)
    .order('code');

  if (listed.error) throw new Error(`Could not list catalog: ${listed.error.message}`);

  let courses = partition((listed.data ?? []) as CatalogRow[], shard);
  if (opts.limit) courses = courses.slice(0, opts.limit);

  console.log(`[${kind}] ${courses.length} courses in this shard`);

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
      await politeDelay();
      const outline = await fetchOutline(course.outline_url!);

      // The source_hash skip is what keeps recurring cost far below the first run.
      if (!opts.force && course.source_hash === outline.sourceHash) {
        totals.coursesSkipped += 1;
        console.log(`  = ${tag} unchanged`);
        continue;
      }

      // First pass, optionally on a cheap model.
      let extraction = await extractScheme(outline.text, { model: opts.cheapModel });
      totals.inputTokens += extraction.inputTokens;
      totals.outputTokens += extraction.outputTokens;

      // Deterministic escalation — never the model's self-reported confidence.
      if (opts.cheapModel) {
        const { escalate, reasons } = needsEscalation(outline.text, extraction.scheme);
        if (escalate) {
          console.log(`  ↑ ${tag} escalating to ${DEFAULT_MODEL}: ${reasons.join('; ')}`);
          extraction = await extractScheme(outline.text, { model: DEFAULT_MODEL });
          totals.inputTokens += extraction.inputTokens;
          totals.outputTokens += extraction.outputTokens;
        }
      }

      const sanitized = sanitizeScheme(extraction.scheme, course.code);

      // Final gate: the SAME invariants module CI and the QA runner use. A scheme that would
      // fail the gate later is caught here, where the notes explaining it are still to hand.
      const gate = validateAgainstEngine(sanitized, course.code);
      if (!gate.ok) {
        sanitized.confidence = 'review';
        sanitized.notes.push(...gate.violations);
      }

      if (opts.dryRun) {
        console.log(
          `  ~ ${tag} [dry-run] ${sanitized.assessments.length} items, ` +
            `${sanitized.rules.length} rules, ${sanitized.confidence}`,
        );
        continue;
      }

      await writeScheme(course, outline, sanitized, runId, extraction.model);
      totals.coursesWritten += 1;
      console.log(
        `  + ${tag} ${sanitized.assessments.length} items, ${sanitized.rules.length} rules, ` +
          `${sanitized.confidence}`,
      );
    } catch (error) {
      // An expired cookie is not a per-course failure — every subsequent fetch will fail the
      // same way, so stop the shard rather than burn the run.
      if (error instanceof CookieExpiredError) {
        await finishRun(runId, { ...totals, error: error.message });
        throw error;
      }
      totals.coursesFailed += 1;
      console.warn(`  ! ${tag} ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await finishRun(runId, totals);
  console.log(
    `[${kind}] done: ${totals.coursesWritten} written, ${totals.coursesSkipped} skipped, ` +
      `${totals.coursesFailed} failed · ${totals.inputTokens} in / ${totals.outputTokens} out tokens`,
  );

  return totals;
}

async function writeScheme(
  course: CatalogRow,
  outline: { url: string; text: string; sourceHash: string },
  sanitized: ReturnType<typeof sanitizeScheme>,
  runId: string | null,
  model: string,
) {
  const client = db();

  // Store the source BEFORE the scheme. The stored copy is what the extraction actually read,
  // so a scheme in the catalog without its source would be unauditable.
  const storagePath = `${course.id}.txt`;
  const upload = await client.storage
    .from('outlines')
    .upload(storagePath, outline.text, { contentType: 'text/plain', upsert: true });
  if (upload.error) console.warn(`  (storage) ${upload.error.message}`);

  // Record the diff before overwriting, so "CS 240 final went 45% -> 50%" can be surfaced.
  if (course.source_hash && course.source_hash !== outline.sourceHash) {
    const previous = await client
      .from('catalog_assessments')
      .select('slug, name, weight')
      .eq('course_id', course.id);

    await client.from('scheme_diffs').insert({
      catalog_course_id: course.id,
      scrape_run_id: runId,
      old_source_hash: course.source_hash,
      new_source_hash: outline.sourceHash,
      old_scheme: { assessments: previous.data ?? [], rules: course.grading_rules ?? [] },
      new_scheme: { assessments: sanitized.assessments, rules: sanitized.rules },
      summary: summarizeDiff(
        (previous.data ?? []) as Array<{ slug: string; weight: number | string }>,
        sanitized.assessments,
      ),
    });
  }

  const updated = await client
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
  if (updated.error) throw new Error(`Catalog update failed: ${updated.error.message}`);

  // Assessments are replaced wholesale, keyed by slug. Users hold forked copies, so replacing
  // catalog rows never touches anybody's marks.
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

  const upserted = await client
    .from('catalog_assessments')
    .upsert(rows, { onConflict: 'course_id,slug' });
  if (upserted.error) throw new Error(`Assessment upsert failed: ${upserted.error.message}`);

  // Remove catalog items the new scheme no longer has.
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
        detail: { note, model },
      })),
    );
  }
}

/** One human line, which is what the notification actually shows. */
function summarizeDiff(
  before: Array<{ slug: string; weight: number | string }>,
  after: Array<{ slug: string; weight: number }>,
): string {
  const beforeMap = new Map(before.map((b) => [b.slug, Number(b.weight)]));
  const changes: string[] = [];

  for (const a of after) {
    const old = beforeMap.get(a.slug);
    if (old == null) {
      changes.push(`${a.slug} added (${a.weight}%)`);
    } else if (Math.abs(old - a.weight) > 0.01) {
      changes.push(`${a.slug} ${old}% → ${a.weight}%`);
    }
    beforeMap.delete(a.slug);
  }
  for (const [slug] of beforeMap) changes.push(`${slug} removed`);

  return changes.length > 0 ? changes.join('; ') : 'Outline text changed; weights unchanged.';
}
