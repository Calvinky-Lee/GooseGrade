# 05 — Backend Session Task List

**You own:** `supabase/` (schema, RLS, RPCs, migrations), `packages/api/` (live implementation),
`packages/engine/` (the shared pure module), and the scraper/QA in `07`.

> **Status (2026-08-19): every task below is implemented.** Paths moved during the workspace
> restructure — `lib/engine` is now `packages/engine`, `lib/api` is `packages/api`, and the
> scraper lives in `jobs/`. Deviations from the task text are annotated inline.
>
> Not yet *exercised against real data*: the scraper, the batch path and the LLM QA tier have
> never run with live credentials. They are built and typechecked, not proven.
**You depend on:** the frozen contract in `02`, `03`, `04`. If reality forces a contract change,
**edit those docs first**, then ping the frontend session.

Work top-to-bottom; each task lists its acceptance check.

## Milestone B0 — Project & DB foundation
- [x] **B0.1** Add migrations (`02 §F`): `03_v2_catalog.sql`, `04_user_tables.sql`,
  `05_distributions_feedback.sql`, `06_rpcs_triggers.sql`, `07_rls.sql`. Keep existing migrations.
  - ✓ `supabase db reset` applies cleanly; tables match `02` field-for-field.
- [x] **B0.2** Backfill existing catalog rows (`credit_weight=0.50`, `grade_basis='numeric'`,
  `grading_rules='[]'`, `scheme_confidence='unconfirmed'`, generated `slug` per assessment).
  - ✓ no null in new NOT-NULL columns; every assessment has a unique slug within its course.
- [x] **B0.3** Create private Storage bucket `outlines/`. Add `MIN_SAMPLE` config (default 5).
  - Both live in migrations (`08_auth_storage.sql`, `05_distributions_feedback.sql`) rather than
    being manual setup steps, so a fresh project cannot come up missing them.

## Milestone B1 — Auth, RLS, profiles
- [x] **B1.1** *(DB trigger in `08_auth_storage.sql`; the TypeScript check is only the message.)*
  Enable Supabase Auth (email/password). Restrict signup to `@uwaterloo.ca` via an
  Auth hook + DB check.
- [x] **B1.2** `handle_new_user()` trigger → auto-create `profiles` row.
- [x] **B1.3** Apply all RLS policies per `02 §D`. **Verify `shared_grades` has no client SELECT.**
  - `supabase/tests/rls.test.ts` — 10 cases, run with `npm run test:db`. Asserts on returned DATA
    rather than on `error`, because RLS filters rather than erroring: a test checking only for an
    error would pass against a wide-open table.
  - ✓ a test JWT for user A cannot read/write user B's rows (write an RLS test script).

## Milestone B2 — The grade engine (`packages/engine/`)  ← do early; it's the riskiest piece
- [x] **B2.1** Implement types from `03 §1–2` in `packages/types/`.
- [x] **B2.2** Implement `computeCourse` with the deterministic rule order (`03 §2`) and the
  **safety contract** (pass gate never mutates average; unresolved refs → skip + warn, never
  throw; disabling all rules == plain weighted sum).
- [x] **B2.3** Implement `requiredForCourse`, `computeTermAverage` (credit-weighted, CR/NCR
  excluded), `requiredAcrossCourses`, and `groupAssessments` (port the legacy grouping, one copy).
- [x] **B2.4** Unit tests for **every** rule type + invariants (`03 §5`). Wire into CI.
  - ✓ coverage of: rule on/off, unresolved refs, all-upcoming/all-graded/mixed, excused vs
    missed, "passing never displays as fail". All green.

## Milestone B3 — Data-access layer (`packages/api/` live impl) — match `04` signatures exactly
- [x] **B3.1** *(`suggestCourses` DEFERRED — amendment A4: no sequence data source exists, and
  paste-first intake removed the need.)* Catalog reads: `searchCatalog`, `getCatalogCourse`,
  `getOutlineSource` (signed Storage URL).
- [x] **B3.2** RPCs: `fork_catalog_course`, `reset_course_to_catalog`, `rollover_term`,
  `get_distribution` (SECURITY DEFINER, min-sample + outlier trim + caller percentile),
  `delete_account`.
- [x] **B3.3** Terms/courses/assessments CRUD: `listTerms`, `getCurrentTerm` (fully populated
  payload), `createTerm`, `setCurrentTerm`, `rolloverTerm`, `addCourseFromCatalog`,
  `addCustomCourse`, `getCourse`, `updateCourse` (sets `rules_overridden` when rules edited),
  `resetCourseToCatalog`, `removeCourse`, assessment CRUD, `reorderAssessments`, `setGrade`.
- [x] **B3.4** Distributions + feedback + profile: `contributeGrades` (gated on opt-in),
  `getCourse/AssessmentDistribution`, `submitFeedback`, `getProfile`, `updateProfile`,
  `exportMyData`, `deleteAccount`.
- [x] **B3.5** Throw `ApiError` with the codes in `04 §7`.
  - Integration suite: `supabase/tests/api-integration.test.ts`, 25 cases against a real database.
    liveApi cannot be covered by unit tests — every mapper depends on a real PostgREST response,
    including numeric-as-string conversion that would otherwise corrupt averages silently.
  - ✓ each function returns the exact shape in `04`; an integration test seeds data and exercises
    every function; `getCurrentTerm` → `computeTermAverage` produces a correct credit-weighted number.

## Milestone B4 — Privacy & ops
- [x] **B4.1** `delete_account` cascades all user rows + that user's `shared_grades`. `exportMyData`
  returns complete JSON. ✓ deleting leaves zero residual rows.
- [x] **B4.2** GitHub Actions CI: typecheck + lint + **engine tests** + build on PR (+ E2E smokes).
  - `next lint` was removed in Next 16 and this repo had no ESLint config, so the lint step had
    never run. Flat config at the root; it also enforces engine purity as an ERROR (importing
    react/next/supabase into `packages/engine` fails CI).

## Milestone B5 — Scraper v2 & QA  (full detail in `07`)
- [x] **B5.1** Generalize term selection (remove hardcoded `1261`).
  - Both halves: the CLI `--term` flag AND the term filter inside the outline search, which was
    also hardcoded. `jobs/src/discover.ts` additionally closes a gap the task list did not name —
    nothing created catalog rows, so `scrape` found zero courses in a fresh term.
- [x] **B5.2** Switch extraction to Claude; emit **`GradingRule[]`** (not just flat weights) +
  `scheme_confidence`. Store source outline to Storage; set `outline_storage_path`, `source_hash`.
- [x] **B5.3** Re-scrape + diff: detect changed schemes vs `source_hash`; surface diffs.
- [x] **B5.4** *(ONE image with three subcommands, not two images — design decision D3. The
  DETERMINISTIC QA tier moved to CI per D4; only the model-bound tier is containerized.)*
  Dockerize the jobs image; K8s Jobs in `k8s/`; QA validates **every** course
  against the engine safety contract and flags failures to `scheme_confidence='review'`.

## Guardrails
- Never mutate catalog rows from a user action — only the service-role scraper writes the catalog.
- Keep server logic in RPCs/Edge Functions; do **not** stand up a 24/7 API service.
- Any contract change ⇒ update `02/03/04` first.
