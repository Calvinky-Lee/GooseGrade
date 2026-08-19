import next from 'eslint-config-next';
import tseslint from 'typescript-eslint';

/**
 * Flat config — `next lint` was removed in Next 16, and B4.2 asks CI to run lint. There was no
 * ESLint config in this repo at all, so `npm run lint` had never worked.
 *
 * Deliberately narrow: this exists to catch real mistakes in CI, not to enforce a style. Anything
 * that would produce hundreds of findings on the inherited v1 code is off, because a lint step
 * nobody can get to zero is a lint step everybody starts ignoring.
 */
export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      '**/.next/**',
      '**/dist/**',
      'playwright-report/**',
      'test-results/**',
      // v1 one-off scripts, slated for deletion once the v2 scraper has run a full term.
      'jobs/legacy/**',
      // Inherited shadcn/ui primitives — vendored, not ours to restyle.
      'apps/web/components/ui/**',
    ],
  },

  ...next,
  ...tseslint.configs.recommended,

  {
    rules: {
      // Deliberate: the engine returns `null` for "no grade yet" and `== null` is the correct
      // check for both null and undefined. Banning it would push code toward `=== null`, which
      // silently misses undefined.
      eqeqeq: ['error', 'always', { null: 'ignore' }],

      // Unused code is a real signal; an unused function ARGUMENT usually is not, and the
      // underscore convention is how we mark it.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],

      // `any` shows up where PostgREST hands back untyped JSON. It is warned, not errored, so
      // it stays visible without blocking a build.
      '@typescript-eslint/no-explicit-any': 'warn',

      // The `!` assertions in the API layer follow explicit null checks that TypeScript's
      // narrowing cannot see across an await. Warn so they stay countable.
      '@typescript-eslint/no-non-null-assertion': 'warn',
    },
  },

  {
    // The engine must stay pure. This is the lint-level expression of the rule that
    // packages/engine imports nothing — a violation here is an architectural regression, not a
    // style nit, so it errors.
    files: ['packages/engine/**/*.ts', 'packages/types/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-dom', 'next', 'next/*', '@supabase/*', '@anthropic-ai/*'],
              message:
                'packages/engine and packages/types must stay dependency-free — they run in the ' +
                'browser, in the API layer, and in the CI QA gate.',
            },
          ],
        },
      ],
    },
  },
);
