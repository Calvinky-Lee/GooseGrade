/**
 * Copyright (c) 2025 GooseGrade
 * All rights reserved.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Legacy v1 client, used only by the not-yet-ported v1 pages.
 *
 * This used to call createClient() at module load with `!` on both env vars. Because the root
 * layout imports SiteHeader which imports this module, a missing NEXT_PUBLIC_SUPABASE_URL
 * crashed EVERY route in the app — including the v2 screens, which run entirely on mock data
 * and have no business requiring Supabase credentials at all.
 *
 * It is now lazy and it throws a message that says what to do. New code should import from
 * `@goosegrade/api` instead, which is what will let these pages be deleted.
 */
function createLegacyClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'The v1 pages need NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
        'The v2 screens under /dashboard do not — they run on mock data.',
    );
  }
  return createClient(url, anonKey);
}

let cached: SupabaseClient | null = null;

/**
 * A Proxy so `import { supabase }` keeps working unchanged in the v1 pages, while construction
 * is deferred to first property access. Nothing is built at import time.
 */
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    cached ??= createLegacyClient();
    const value = Reflect.get(cached, prop, receiver);
    return typeof value === 'function' ? value.bind(cached) : value;
  },
});
