/**
 * Supabase client for the data-access layer.
 *
 * The browser gets the ANON key only — RLS does the protecting (specs/01 §Security). The
 * service-role key is never imported here; it exists only in the jobs workspace.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

export function getClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required in live mode. ' +
        'Set NEXT_PUBLIC_API_MODE=mock to run without a backend.',
    );
  }

  cached = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return cached;
}

/** Test seam — lets an integration test inject a service-role client. */
export function setClient(client: SupabaseClient | null): void {
  cached = client;
}
