import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    // The engine is pure — no DOM, no network, no Supabase. Keeping the default
    // 'node' environment is deliberate: if a test needs jsdom, something has
    // leaked into lib/engine that does not belong there.
    environment: 'node',
    include: ['lib/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
