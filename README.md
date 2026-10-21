# GooseGrade

Anonymous, single-course grade calculator for UWaterloo. Next.js/React frontend and a read-only public Supabase catalog. No accounts, saved grades, or multicourse dashboard.

## Local development

Use Node 20.9 or newer, install dependencies with `npm ci`, and provide `.env.local` with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Import scripts additionally need `SUPABASE_SERVICE_ROLE_KEY` and `WATERLOO_SESSION_COOKIE`. Optional model extraction needs `OPENAI_API_KEY`.

Never commit environment files or the `.import-cache` directory. Client roles cannot change shared course data.

```sh
npm run dev
npm test
npm run typecheck
npm run build
npm start
```

## Winter 2027 refresh

The import target is Winter 2027 (`1271`). The offerings list supplies course codes/titles, not assessment weights. Historical terms remain separate.

Apply `supabase/migrations/03_winter_2027_catalog.sql` to an existing v1 database first. On a fresh database, use `supabase/schema.sql` followed by migration 03; do not also run migration 01, which repeats the base schema's unique constraint. `supabase/verify-catalog.sql` tests permissions, exact sums, stable IDs and rollback using fixtures inside a rolled-back transaction.

```sh
# Fresh discovery: checks every code, including previously missing outlines.
npm run catalog:discover

# Only after an interrupted run: resume completed checkpoints.
npm run catalog:discover -- --resume

# Stage and validate, without database writes or model calls.
npm run catalog:refresh

# Upsert offerings and publish only validated source-backed schemes.
npm run catalog:refresh -- --apply

# Optional bounded model extraction for sources tables could not resolve.
npm run catalog:refresh -- --extract --max-model-calls=5
# Inspect .import-cache/1271/outcomes.json, then publish the validated results.
npm run catalog:refresh -- --apply
```

Discovery uses two workers with a 700 ms pause between requests, follows API pagination and validates exact course/term identity. It uses curl with normal TLS verification for the public listing because Node certificate-chain validation failed for that host on the development machine. Outline requests remain authenticated HTTPS requests. Cookie failures are errors, not missing outlines.

Each source has a private content-hash cache. The model limit defaults to five calls, requires `--extract`, and caps each source at 100,000 characters and each completion at 6,000 tokens. Review current provider prices and staged source sizes before increasing the call limit. No model calls are required for catalog-only publication.

Only complete fixed schemes with explicit source evidence can be published. Conditional rules, missing categories and ambiguous extraction require review. Normalization corrects only source-supported decimal rounding, up to 0.05 percentage points, at ten-decimal storage precision. It never rescales arbitrary incomplete totals to 100. The RPC publishes each scheme in one transaction and preserves stable IDs on rerun.

Legacy scrape/add/clean/normalize/clear writers are retired and exit with instructions for the new workflow. Read-only legacy inspection scripts remain for reference; the full catalog audit is the source of coverage truth. No automatic schedule has been created.

## Verified refresh result

October 21, 2026: 1,658/1,658 Winter 2027 source codes were checked with the authenticated outline API. No matching Winter 2027 outlines were returned. All 1,658 offerings are in Supabase with pending weightings; no historical scheme was relabeled or used as a replacement. Historical counts remained 1,203 course sections and 12,061 assessments. Zero paid extraction calls were made.

The frontend is unchanged from the original main branch. Pending offerings are stored in the backend catalog; the original interface continues reading existing course schemes. Winter 2027 assessment schemes will become available only after matching outlines are published and validated.

## Verification artifacts

- `tests/`: term parsing, source evidence, exact normalization, pagination and authentication handling.
- `supabase/verify-catalog.sql`: transactional database integration checks.
- `docs/superpowers/specs/2026-10-20-winter-2027.md`: backend-only scope.
- `docs/superpowers/plans/2026-10-20-winter-2027.md`: implementation ledger.

The previous `specs/` v2 accounts/dashboard proposals are historical context and are not the implementation roadmap.
