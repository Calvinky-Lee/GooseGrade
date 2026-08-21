# 02 — Data Model (Postgres / Supabase)

**Status: contract.** This is the agreement between the backend and frontend sessions.
Field names here are authoritative — the TS types in `03-domain-types.md` mirror them exactly.

## Design principles

1. **Two worlds, cleanly separated:**
   - **Catalog** = canonical, scraped, **read-only to all users**. The shared template.
   - **User data** = everything a signed-in student owns. Protected by RLS so a user can
     only ever touch their own rows.
2. **Fork-on-add (layered overrides).** When a student adds a catalog course, we **copy** its
   assessments + rules into their `user_courses`/`user_assessments` rows. The catalog is never
   mutated by a user (this is the fix for the legacy bug where renames wrote to the shared table).
   A `reset_to_catalog` action re-copies from the source.
3. **Rules as JSONB documents** attached to a course, referencing assessments by a stable
   `slug`. This matches what the scraper emits and what the engine consumes (see `03`).
4. **Stable slugs.** Every assessment has a `slug` (e.g. `assignment-1`, `final-exam`) that is
   stable across re-scrapes and across the catalog→user fork, so distributions and rule
   references survive edits.

---

## A. Catalog tables (read-only template)

### `catalog_courses`
One row per **course section offering in a term** (mirrors today's `courses` table, which already
treats each section/outline as a row).

| column | type | notes |
|---|---|---|
| `id` | uuid PK | `default uuid_generate_v4()` |
| `code` | text NOT NULL | normalized, e.g. `"CS 240"` |
| `name` | text NOT NULL | course/section title |
| `department` | text | e.g. `"CS"` |
| `section` | text | e.g. `"001"` (nullable; parsed from outline title) |
| `term` | text NOT NULL | e.g. `"Winter 2026"` |
| `term_date` | date NOT NULL | first day of term (for ordering) |
| `credit_weight` | numeric(3,2) NOT NULL DEFAULT 0.50 | **UW credit value** (0.50, 1.00, 0.25, …). Drives credit-weighted averages. |
| `grade_basis` | text NOT NULL DEFAULT `'numeric'` | `'numeric'` \| `'cr_ncr'` — `cr_ncr` excluded from averages |
| `grading_rules` | jsonb NOT NULL DEFAULT `'[]'` | array of `GradingRule` (see `03`) |
| `scheme_confidence` | text NOT NULL DEFAULT `'unconfirmed'` | `'unconfirmed'` \| `'review'` \| `'verified'` |
| `outline_url` | text | source outline URL |
| `outline_storage_path` | text | path in Supabase Storage bucket `outlines/` (for download/source link) |
| `source_hash` | text | hash of parsed outline content, for re-scrape diffing |
| `last_scraped` | timestamptz DEFAULT now() | |
| `created_at` | timestamptz DEFAULT now() | |

Unique: `(code, term, section, outline_url)`.
Indexes: `code`, `term_date desc`, `department`.

### `catalog_assessments`
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `course_id` | uuid NOT NULL REFERENCES catalog_courses(id) ON DELETE CASCADE | |
| `slug` | text NOT NULL | stable key, unique within course (`assignment-1`) |
| `name` | text NOT NULL | display name (`"Assignment 1"`) |
| `category` | text | `Assignment`\|`Quiz`\|`Lab`\|`Midterm`\|`Final Exam`\|`Participation`\|`Project`\|`Other` |
| `assessment_type` | text NOT NULL | same vocabulary as category; kept for engine grouping |
| `weight` | numeric(20,10) NOT NULL | base individual weight (% of course) |
| `order_index` | integer NOT NULL | display order |

Unique: `(course_id, slug)`. Index: `course_id`.

---

## B. User tables (RLS-protected, `user_id = auth.uid()`)

### `profiles`  (1:1 with `auth.users`)
| column | type | notes |
|---|---|---|
| `id` | uuid PK REFERENCES auth.users(id) ON DELETE CASCADE | = `auth.uid()` |
| `email` | text | UW email (verified by Auth) |
| `display_name` | text | |
| `faculty` | text | e.g. `"Mathematics"` |
| `program` | text | e.g. `"Computer Science"` |
| `current_level` | text | e.g. `"2B"` (drives term/level auto-suggest) |
| `settings` | jsonb NOT NULL DEFAULT `'{}'` | `{ contributeDistributions: bool, theme: 'light'\|'dark' }` |
| `created_at` | timestamptz DEFAULT now() | |

Created automatically on signup via a trigger on `auth.users` (see §E).

### `user_terms`
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid NOT NULL → auth.users | |
| `term_label` | text NOT NULL | `"Winter 2026"` |
| `term_date` | date NOT NULL | for ordering / rollover |
| `is_current` | boolean NOT NULL DEFAULT true | exactly one current term per user (enforced in app/RPC) |
| `created_at` | timestamptz DEFAULT now() | |

Index: `(user_id, term_date desc)`.

### `user_courses`  (a forked, editable copy)
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid NOT NULL → auth.users | |
| `user_term_id` | uuid NOT NULL REFERENCES user_terms(id) ON DELETE CASCADE | |
| `catalog_course_id` | uuid REFERENCES catalog_courses(id) ON DELETE SET NULL | nullable → fully custom course |
| `code` | text NOT NULL | copied, user-editable |
| `name` | text NOT NULL | copied, user-editable |
| `section` | text | |
| `credit_weight` | numeric(3,2) NOT NULL DEFAULT 0.50 | copied; user-editable |
| `grade_basis` | text NOT NULL DEFAULT `'numeric'` | `'numeric'`\|`'cr_ncr'` |
| `grading_rules` | jsonb NOT NULL DEFAULT `'[]'` | forked copy; user can toggle/edit (layered override) |
| `rules_overridden` | boolean NOT NULL DEFAULT false | true once user edits rules (controls "reset to official") |
| `target_grade` | numeric(5,2) | user's goal for this course |
| `color` | text | optional UI accent |
| `created_at` / `updated_at` | timestamptz | |

Index: `(user_id, user_term_id)`.

### `user_assessments`  (forked, editable; holds the actual grades)
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid NOT NULL → auth.users | |
| `user_course_id` | uuid NOT NULL REFERENCES user_courses(id) ON DELETE CASCADE | |
| `catalog_assessment_id` | uuid REFERENCES catalog_assessments(id) ON DELETE SET NULL | nullable → custom item |
| `slug` | text NOT NULL | stable key (carried from catalog or generated for custom) |
| `name` | text NOT NULL | user-editable |
| `category` | text | |
| `assessment_type` | text NOT NULL | |
| `weight` | numeric(20,10) NOT NULL | user-editable effective base weight |
| `order_index` | integer NOT NULL | |
| `grade` | numeric(7,4) | the student's mark (%); null = not entered |
| `status` | text NOT NULL DEFAULT `'upcoming'` | `'upcoming'`\|`'graded'`\|`'excused'`\|`'missed'` |
| `is_custom` | boolean NOT NULL DEFAULT false | added by user, not from catalog |
| `is_removed` | boolean NOT NULL DEFAULT false | soft-remove (keeps slug/ref) |
| `created_at` / `updated_at` | timestamptz | |

Unique: `(user_course_id, slug)`. Index: `(user_id, user_course_id)`.

> **`status` is the correctness keystone.** `excused` removes the item's weight from the
> denominator (not a zero); `missed` is a real zero (subject to redistribution rules). This is
> precisely the distinction that prevents wrongly failing a student.

---

## C. Crowdsourced distributions (privacy-critical)

### `shared_grades`  (anonymized contributions — never read directly by clients)
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `contributor_id` | uuid NOT NULL → auth.users | **internal only** — for dedup + abuse control; NEVER exposed |
| `catalog_course_id` | uuid NOT NULL REFERENCES catalog_courses(id) ON DELETE CASCADE | |
| `catalog_assessment_id` | uuid REFERENCES catalog_assessments(id) ON DELETE CASCADE | null = course-level contribution |
| `term` | text NOT NULL | per-term separation (never mix terms) |
| `grade` | numeric(7,4) NOT NULL | 0–100 (or 0–course max) |
| `created_at` | timestamptz DEFAULT now() | |

Unique: `(contributor_id, catalog_assessment_id, term)` and
`(contributor_id, catalog_course_id, term)` where assessment is null — one contribution per
person per item per term (re-submit = upsert).

**RLS:** a user may `INSERT`/`UPDATE`/`DELETE` only rows where `contributor_id = auth.uid()`.
**No client `SELECT` is allowed at all.** Reads happen exclusively through the
`get_distribution()` RPC (§E), which enforces the minimum-sample floor and returns only
aggregates — so no individual grade is ever identifiable.

Anti-abuse: contributions are bounded to plausible ranges; the aggregation RPC trims outliers
(see `04` / `07`). Contributions are gated on `profiles.settings.contributeDistributions = true`
(give-to-get).

### `feedback`
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid → auth.users | nullable (allow anonymous) |
| `category` | text NOT NULL | `'bug'`\|`'suggestion'`\|`'course_data'`\|`'other'` |
| `message` | text NOT NULL | |
| `page_url` | text | where it was submitted |
| `created_at` | timestamptz DEFAULT now() | |

**RLS:** `INSERT` allowed for anyone (authed or anon role per app policy); **no client `SELECT`**
(admin/dashboard only via service role).

---

## C2. Pipeline provenance (added 2026-08-17 — amendments A7, A8)

`07` requires recording re-scrape diffs and QA outcomes but `02` defined nowhere to put
them. Both are **service-role write, public read** — a student needs to see *why* their
course is flagged, and to be told when a scheme changed under them.

### `scrape_runs`
One row per scraper or QA invocation. Cheap, queryable run history — this is the
observability story, in place of a metrics stack.

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `kind` | text NOT NULL | `'scrape'` \| `'rescrape'` \| `'qa'` |
| `term` | text | target term, null for QA over all terms |
| `shard_index` / `shard_count` | integer | from `JOB_COMPLETION_INDEX` / `CLOUD_RUN_TASK_INDEX` |
| `model` | text | e.g. `'claude-opus-5'`; null for deterministic QA |
| `courses_seen` / `courses_written` / `courses_skipped` / `courses_failed` | integer NOT NULL DEFAULT 0 | `skipped` = unchanged `source_hash` |
| `input_tokens` / `output_tokens` | bigint | for real per-term cost accounting |
| `started_at` | timestamptz NOT NULL DEFAULT now() | |
| `finished_at` | timestamptz | null while running |
| `error` | text | set when the shard died |

### `scheme_diffs`
Backs the catalog-trust notification ("CS 240 final went 45% → 50%").

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `catalog_course_id` | uuid NOT NULL REFERENCES catalog_courses(id) ON DELETE CASCADE | |
| `scrape_run_id` | uuid REFERENCES scrape_runs(id) ON DELETE SET NULL | |
| `old_source_hash` / `new_source_hash` | text | |
| `old_scheme` / `new_scheme` | jsonb NOT NULL | `{ assessments, rules }` snapshots |
| `summary` | text NOT NULL | human line: `"Final Exam 45% → 50%"` |
| `detected_at` | timestamptz NOT NULL DEFAULT now() | |
| `acknowledged_at` | timestamptz | set once surfaced to affected users |

Index: `(catalog_course_id, detected_at desc)`.

### `qa_findings`
A `scheme_confidence='review'` flag with no attached reason is unactionable. This is the
reason.

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `catalog_course_id` | uuid NOT NULL REFERENCES catalog_courses(id) ON DELETE CASCADE | |
| `scrape_run_id` | uuid REFERENCES scrape_runs(id) ON DELETE SET NULL | |
| `tier` | text NOT NULL | `'deterministic'` \| `'llm'` (see `07 §7`) |
| `severity` | text NOT NULL | `'info'` \| `'warn'` \| `'violation'` — only `violation` sets `review` |
| `invariant` | text NOT NULL | stable key, e.g. `'ceiling_exceeds_max'`, `'rules_off_diverges'` |
| `detail` | jsonb NOT NULL DEFAULT `'{}'` | fixture + actual/expected, for triage |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |

Index: `(catalog_course_id, created_at desc)`, `(invariant)`.

---

## D. Row-Level Security summary

| table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `catalog_courses` | public (true) | service role only | service role only | service role only |
| `catalog_assessments` | public (true) | service role only | service role only | service role only |
| `profiles` | `id = auth.uid()` | `id = auth.uid()` | `id = auth.uid()` | cascade w/ auth user |
| `user_terms` | `user_id = auth.uid()` | same | same | same |
| `user_courses` | `user_id = auth.uid()` | same | same | same |
| `user_assessments` | `user_id = auth.uid()` | same | same | same |
| `shared_grades` | **none** (RPC only) | `contributor_id = auth.uid()` | same | same |
| `feedback` | none | authed (or anon) | none | none |
| `scrape_runs` | public (true) | service role only | service role only | service role only |
| `scheme_diffs` | public (true) | service role only | service role only | service role only |
| `qa_findings` | public (true) | service role only | service role only | service role only |

Every user table policy is literally `auth.uid() = user_id`. The database — not application
code — guarantees isolation.

---

## E. Functions, triggers, RPCs (backend owns; signatures are contract — full I/O in `04`)

- **`handle_new_user()`** trigger on `auth.users` insert → creates a `profiles` row.
- **`set_updated_at()`** trigger on user tables → maintains `updated_at`.
- **`fork_catalog_course(p_catalog_course_id uuid, p_user_term_id uuid) returns uuid`** —
  atomically copies a catalog course + its assessments into `user_courses`/`user_assessments`
  for the caller; returns the new `user_course_id`. Idempotency: error if already added to that term.
- **`reset_course_to_catalog(p_user_course_id uuid)`** — re-copies rules/assessments from the
  source catalog course (preserves entered grades by `slug` where possible).
- **`rollover_term(p_from_term_id uuid, p_new_label text, p_new_term_date date) returns uuid`** —
  creates a new `user_term`, marks it current, optionally clones course shells.
- **`get_distribution(p_catalog_course_id uuid, p_catalog_assessment_id uuid, p_term text)
  returns table(...)`** — SECURITY DEFINER; returns histogram buckets + count + mean + median
  **only if count ≥ MIN_SAMPLE (config, default 5)**, else returns `{ available: false }`.
  Also returns the caller's percentile if they have a matching grade.
- **`delete_account()`** — SECURITY DEFINER; deletes the caller's auth user (cascades all user
  data + their `shared_grades`). Backs the privacy "delete my data" requirement.

---

## F. Migration & seeding notes (backend)

- Keep existing `supabase/migrations/`. Add migrations: `03_v2_catalog.sql` (rename/extend
  `courses`→`catalog_courses`, `assessments`→`catalog_assessments`, add new columns),
  `04_user_tables.sql`, `05_distributions_feedback.sql`, `06_rpcs_triggers.sql`, `07_rls.sql`.
- Backfill: existing rows get `credit_weight = 0.50`, `grade_basis = 'numeric'`,
  `grading_rules = '[]'`, `scheme_confidence = 'unconfirmed'`, and a generated `slug` per
  assessment (`<category>-<n>` or `slugify(name)`).
- Create a private Storage bucket `outlines/` for stored source outlines.
- Config table or env for `MIN_SAMPLE` (default 5).
