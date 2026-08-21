import { defineConfig } from 'vitest/config';

/**
 * Database-backed tests (RLS). Separate config because these need real credentials and a real
 * Postgres, so they must not run as part of `npm test`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['supabase/tests/**/*.test.ts'],
    // Creating and signing in users is slow; RLS checks are also order-dependent within a file.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
