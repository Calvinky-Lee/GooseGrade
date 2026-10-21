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

## Fall 2026 refresh

The import target is Fall 2026 (`1269`). The term-specific undergraduate and graduate schedules supply course codes/titles, not assessment weights. Use `--term=1271` explicitly for a future Winter 2027 run. Historical terms remain separate.

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
# Inspect .import-cache/1269/outcomes.json, then publish the validated results.
npm run catalog:refresh -- --apply
```

Discovery scans every subject in both schedule levels, then queries the authenticated viewer by subject and term and validates exact course/term identity. It uses curl with normal TLS verification for the public listing because Node certificate-chain validation failed for that host on the development machine. Outline requests remain authenticated HTTPS requests. Cookie failures are errors, not missing outlines.

Each source has a private content-hash cache. The model limit defaults to five calls, requires `--extract`, and caps each source at 100,000 characters and each completion at 6,000 tokens. Review current provider prices and staged source sizes before increasing the call limit. No model calls are required for catalog-only publication.

Only complete fixed schemes with explicit source evidence can be published. Conditional rules, missing categories and ambiguous extraction require review. Normalization corrects only source-supported decimal rounding, up to 0.05 percentage points, at ten-decimal storage precision. It never rescales arbitrary incomplete totals to 100. The RPC publishes each scheme in one transaction and preserves stable IDs on rerun.

Legacy scrape/add/clean/normalize/clear writers are retired and exit with instructions for the new workflow. Read-only legacy inspection scripts remain for reference; the full catalog audit is the source of coverage truth. No automatic schedule has been created.

## Refresh status

Fall 2026 discovery checked 2,387 official course codes across 153 subjects. The authenticated viewer returned 1,954 course-outline pairs covering 1,685 codes. The other 702 codes have no published matching outline in that viewer. Publication results are in `.import-cache/1269/publication-summary.json` and per-outline reasons in `outcomes.json`.

The original frontend is preserved, with only the requested circular help button and missing-course popup added. Published Fall schemes appear through its existing course queries. Pending offerings and review cases remain backend records, not fabricated grade schemes. Winter 2026 history and the earlier Winter 2027 pending manifest are retained separately.

`--resume` on discovery reuses completed checks. On refresh it reuses private downloaded HTML; omit it for fresh source retrieval. Two workers process outlines. Only source-backed fixed schemes are published; conditional schemes remain for review. Model extraction is bounded by `--max-model-calls` and skips sources already known to contain conditional grading.

## Verification artifacts

- `tests/`: term parsing, schedule parsing, source evidence, explicit percentage-column interpretation, normalization, pagination and authentication handling.
- `supabase/verify-catalog.sql`: transactional database integration checks.

No frontend redesign, accounts, saved grades or multicourse dashboard is included.

## Missing-course requests

Apply `supabase/migrations/04_course_requests.sql` to activate the private request queue. The popup submits a course code, optional Waterloo outline URL and optional notes through `/api/course-requests`. Anonymous visitors can insert only these fields and cannot read, edit or delete requests. The existing service role manages the queue. Duplicate course/term requests share one queue entry. Review requests in the Supabase `course_requests` table.

Verified October 21, 2026: 640 Fall schemes covering 579 codes and 3,148 assessments published; every scheme was revalidated against its saved source and totals exactly 100%. There are 1,314 outline schemes held for review, while 702 offered codes have no published matching outline. No model calls have been made. The historical 1,203 Winter 2026 sections and 12,061 assessments are intact. The request popup passed an end-to-end save check and anonymous reads were denied; the labelled test request was marked resolved.
