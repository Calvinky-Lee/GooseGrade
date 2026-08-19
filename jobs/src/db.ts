/**
 * Service-role Supabase client for the jobs workspace.
 *
 * This key BYPASSES RLS, which is exactly why it lives only here and never in apps/web. It is
 * the only credential that can write the catalog — specs/02 §D: "service role only".
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '../.env.local' });

let cached: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Jobs need SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.',
    );
  }

  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

/** Open a run row so every write is traceable to a run, shard, and model (specs/02 §C2). */
export async function startRun(input: {
  kind: 'scrape' | 'rescrape' | 'qa';
  term?: string | null;
  shardIndex?: number;
  shardCount?: number;
  model?: string | null;
}): Promise<string | null> {
  const { data, error } = await db()
    .from('scrape_runs')
    .insert({
      kind: input.kind,
      term: input.term ?? null,
      shard_index: input.shardIndex ?? null,
      shard_count: input.shardCount ?? null,
      model: input.model ?? null,
    })
    .select('id')
    .single();

  if (error) {
    // A missing run row must not abort the actual work — it is provenance, not the job.
    console.warn(`Could not open scrape_runs row: ${error.message}`);
    return null;
  }
  return (data as { id: string }).id;
}

export async function finishRun(
  runId: string | null,
  totals: {
    coursesSeen: number;
    coursesWritten: number;
    coursesSkipped: number;
    coursesFailed: number;
    inputTokens?: number;
    outputTokens?: number;
    error?: string | null;
  },
): Promise<void> {
  if (!runId) return;
  await db()
    .from('scrape_runs')
    .update({
      finished_at: new Date().toISOString(),
      courses_seen: totals.coursesSeen,
      courses_written: totals.coursesWritten,
      courses_skipped: totals.coursesSkipped,
      courses_failed: totals.coursesFailed,
      input_tokens: totals.inputTokens ?? null,
      output_tokens: totals.outputTokens ?? null,
      error: totals.error ?? null,
    })
    .eq('id', runId);
}
