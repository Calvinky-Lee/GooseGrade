import { defineConfig } from 'vitest/config';
import path from 'node:path';

const r = (p: string) => path.resolve(__dirname, p);

export default defineConfig({
  resolve: {
    alias: {
      '@goosegrade/types': r('packages/types/src/index.ts'),
      '@goosegrade/engine': r('packages/engine/src/index.ts'),
      '@goosegrade/api': r('packages/api/src/index.ts'),
      '@': r('apps/web'),
    },
  },
  test: {
    // The engine is pure — no DOM, no network, no Supabase. Keeping the default 'node'
    // environment is deliberate: if a test ever needs jsdom, something has leaked into
    // packages/engine that does not belong there.
    environment: 'node',
    include: ['packages/**/*.test.ts', 'jobs/**/*.test.ts', 'apps/web/**/*.test.ts'],
    // supabase/tests/* talk to a real database and self-skip without credentials. Excluded
    // from the default run so `npm test` stays offline and fast; run them with
    // `npm run test:db`.
    exclude: ['**/node_modules/**', 'supabase/tests/**'],
  },
});
