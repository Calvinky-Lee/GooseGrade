# 05 — Backend Session Task List

**You own:** `supabase/` (schema, RLS, RPCs, migrations), `lib/api/` (live implementation),
`lib/engine/` (the shared pure module), and the scraper/QA in `07`.
**You depend on:** the frozen contract in `02`, `03`, `04`. If reality forces a contract change,
**edit those docs first**, then ping the frontend session.

Work top-to-bottom; each task lists its acceptance check.

## Milestone B0 — Project & DB foundation
- [ ] **B0.1** Add migrations (`02 §F`): `03_v2_catalog.sql`, `04_user_tables.sql`,
  `05_distributions_feedback.sql`, `06_rpcs_triggers.sql`, `07_rls.sql`. Keep existing migrations.
  - ✓ `supabase db reset` applies cleanly; tables match `02` field-for-field.
- [ ] **B0.2** Backfill existing catalog rows (`credit_weight=0.50`, `grade_basis='numeric'`,
  `grading_rules='[]'`, `scheme_confidence='unconfirmed'`, generated `slug` per assessment).
  - ✓ no null in new NOT-NULL columns; every assessment has a unique slug within its course.
- [ ] **B0.3** Create private Storage bucket `outlines/`. Add `MIN_SAMPLE` config (default 5).

## Milestone B1 — Auth, RLS, profiles
- [ ] **B1.1** Enable Supabase Auth (email/password). Restrict signup to `@uwaterloo.ca` via an
  Auth hook + DB check.
- [ ] **B1.2** `handle_new_user()` trigger → auto-create `profiles` row.
- [ ] **B1.3** Apply all RLS policies per `02 §D`. **Verify `shared_grades` has no client SELECT.**
  - ✓ a test JWT for user A cannot read/write user B's rows (write an RLS test script).

## Milestone B2 — The grade engine (`lib/engine/`)  ← do early; it's the riskiest piece
- [ ] **B2.1** Implement types from `03 §1–2` in `lib/types/`.
- [ ] **B2.2** Implement `computeCourse` with the deterministic rule order (`03 §2`) and the
  **safety contract** (pass gate never mutates average; unresolved refs → skip + warn, never
  throw; disabling all rules == plain weighted sum).
- [ ] **B2.3** Implement `requiredForCourse`, `computeTermAverage` (credit-weighted, CR/NCR
  excluded), `requiredAcrossCourses`, and `groupAssessments` (port the legacy grouping, one copy).
- [ ] **B2.4** Unit tests for **every** rule type + invariants (`03 §5`). Wire into CI.
  - ✓ coverage of: rule on/off, unresolved refs, all-upcoming/all-graded/mixed, excused vs
    missed, "passing never displays as fail". All green.

## Milestone B3 — Data-access layer (`lib/api/` live impl) — match `04` signatures exactly
- [ ] **B3.1** Catalog reads: `searchCatalog`, `getCatalogCourse`, `suggestCourses`,
  `getOutlineSource` (signed Storage URL).
- [ ] **B3.2** RPCs: `fork_catalog_course`, `reset_course_to_catalog`, `rollover_term`,
  `get_distribution` (SECURITY DEFINER, min-sample + outlier trim + caller percentile),
  `delete_account`.
- [ ] **B3.3** Terms/courses/assessments CRUD: `listTerms`, `getCurrentTerm` (fully populated
  payload), `createTerm`, `setCurrentTerm`, `rolloverTerm`, `addCourseFromCatalog`,
  `addCustomCourse`, `getCourse`, `updateCourse` (sets `rules_overridden` when rules edited),
  `resetCourseToCatalog`, `removeCourse`, assessment CRUD, `reorderAssessments`, `setGrade`.
- [ ] **B3.4** Distributions + feedback + profile: `contributeGrades` (gated on opt-in),
  `getCourse/AssessmentDistribution`, `submitFeedback`, `getProfile`, `updateProfile`,
  `exportMyData`, `deleteAccount`.
- [ ] **B3.5** Throw `ApiError` with the codes in `04 §7`.
  - ✓ each function returns the exact shape in `04`; an integration test seeds data and exercises
    every function; `getCurrentTerm` → `computeTermAverage` produces a correct credit-weighted number.

## Milestone B4 — Privacy & ops
- [ ] **B4.1** `delete_account` cascades all user rows + that user's `shared_grades`. `exportMyData`
  returns complete JSON. ✓ deleting leaves zero residual rows.
- [ ] **B4.2** GitHub Actions CI: typecheck + lint + **engine tests** + build on PR.

## Milestone B5 — Scraper v2 & QA  (full detail in `07`)
- [ ] **B5.1** Generalize term selection (remove hardcoded `1261`).
- [ ] **B5.2** Switch extraction to Claude; emit **`GradingRule[]`** (not just flat weights) +
  `scheme_confidence`. Store source outline to Storage; set `outline_storage_path`, `source_hash`.
- [ ] **B5.3** Re-scrape + diff: detect changed schemes vs `source_hash`; surface diffs.
- [ ] **B5.4** Dockerize scraper + QA runner; K8s Jobs in `k8s/`; QA validates **every** course
  against the engine safety contract and flags failures to `scheme_confidence='review'`.

## Guardrails
- Never mutate catalog rows from a user action — only the service-role scraper writes the catalog.
- Keep server logic in RPCs/Edge Functions; do **not** stand up a 24/7 API service.
- Any contract change ⇒ update `02/03/04` first.
