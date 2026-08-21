import { defineConfig, devices } from '@playwright/test';

/**
 * E2E smokes — specs/01 §Testing item 4: "a few flows", not a second test suite.
 *
 * They run against mock mode, so they need no database and no credentials. That is what makes
 * them safe to run in CI on every PR: the flows exercised are the ones the engine tests cannot
 * reach, namely that the wiring between screen, API layer and engine actually holds.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev --workspace @goosegrade/web -- --port 3100',
    url: 'http://localhost:3100/dashboard',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_API_MODE: 'mock',
      NEXT_PUBLIC_SUPABASE_URL: 'https://placeholder.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'placeholder',
    },
  },
});
