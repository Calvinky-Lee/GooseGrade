-- 05_distributions_feedback.sql — crowd distributions, feedback, and pipeline provenance.
--
-- specs/02-data-model.md §C and §C2 (added by amendment A7/A8).

-- ---------------------------------------------------------------------------
-- shared_grades — privacy-critical. NEVER read directly by a client.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shared_grades (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Internal only, for dedup and abuse control. NEVER exposed: there is no client SELECT
  -- policy on this table at all, and get_distribution() returns aggregates only.
  contributor_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  catalog_course_id UUID NOT NULL REFERENCES catalog_courses (id) ON DELETE CASCADE,
  catalog_assessment_id UUID REFERENCES catalog_assessments (id) ON DELETE CASCADE,
  -- Amendment A5: contributions are keyed by slug, not by catalog_assessment_id, so a student
  -- who renamed an item still contributes. The assessment id is kept for convenience but the
  -- slug is what identity is based on.
  slug TEXT,
  term TEXT NOT NULL,
  grade NUMERIC(7, 4) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Anti-abuse: bound contributions to a plausible range. The aggregation RPC trims outliers
  -- on top of this.
  CONSTRAINT shared_grades_grade_range CHECK (grade >= 0 AND grade <= 150)
);

-- One contribution per person per item per term; re-submitting is an upsert.
CREATE UNIQUE INDEX IF NOT EXISTS shared_grades_per_item_key
  ON shared_grades (contributor_id, catalog_course_id, slug, term)
  WHERE slug IS NOT NULL;

-- Course-level contributions (no specific assessment).
CREATE UNIQUE INDEX IF NOT EXISTS shared_grades_per_course_key
  ON shared_grades (contributor_id, catalog_course_id, term)
  WHERE slug IS NULL;

CREATE INDEX IF NOT EXISTS shared_grades_lookup_idx
  ON shared_grades (catalog_course_id, slug, term);

-- ---------------------------------------------------------------------------
-- feedback
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Nullable: anonymous feedback is allowed, since the people most likely to report bad
  -- course data are the ones who have not signed up yet.
  user_id UUID REFERENCES auth.users (id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  page_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT feedback_category_check
    CHECK (category IN ('bug', 'suggestion', 'course_data', 'other')),
  CONSTRAINT feedback_message_not_empty CHECK (length(trim(message)) > 0)
);

-- ---------------------------------------------------------------------------
-- Pipeline provenance (amendments A7, A8) — specs/02 §C2
-- ---------------------------------------------------------------------------

-- Queryable run history. This is the observability story in place of a metrics stack, and it
-- is more useful than one because it can be joined against the courses it touched.
CREATE TABLE IF NOT EXISTS scrape_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind TEXT NOT NULL,
  term TEXT,
  shard_index INTEGER,
  shard_count INTEGER,
  model TEXT,
  courses_seen INTEGER NOT NULL DEFAULT 0,
  courses_written INTEGER NOT NULL DEFAULT 0,
  -- Unchanged source_hash. Tracking this is how we prove the re-scrape skip is working.
  courses_skipped INTEGER NOT NULL DEFAULT 0,
  courses_failed INTEGER NOT NULL DEFAULT 0,
  input_tokens BIGINT,
  output_tokens BIGINT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  error TEXT,

  CONSTRAINT scrape_runs_kind_check CHECK (kind IN ('scrape', 'rescrape', 'qa'))
);

CREATE INDEX IF NOT EXISTS scrape_runs_started_idx ON scrape_runs (started_at DESC);

-- Backs the catalog-trust notification: "CS 240 final went 45% -> 50%".
CREATE TABLE IF NOT EXISTS scheme_diffs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  catalog_course_id UUID NOT NULL REFERENCES catalog_courses (id) ON DELETE CASCADE,
  scrape_run_id UUID REFERENCES scrape_runs (id) ON DELETE SET NULL,
  old_source_hash TEXT,
  new_source_hash TEXT,
  old_scheme JSONB NOT NULL,
  new_scheme JSONB NOT NULL,
  summary TEXT NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS scheme_diffs_course_idx
  ON scheme_diffs (catalog_course_id, detected_at DESC);

-- A scheme_confidence='review' flag with no attached reason is unactionable. This is the
-- reason. `invariant` values come from lib/engine/invariants.ts InvariantKey.
CREATE TABLE IF NOT EXISTS qa_findings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  catalog_course_id UUID NOT NULL REFERENCES catalog_courses (id) ON DELETE CASCADE,
  scrape_run_id UUID REFERENCES scrape_runs (id) ON DELETE SET NULL,
  tier TEXT NOT NULL,
  severity TEXT NOT NULL,
  invariant TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT qa_findings_tier_check CHECK (tier IN ('deterministic', 'llm')),
  CONSTRAINT qa_findings_severity_check CHECK (severity IN ('info', 'warn', 'violation'))
);

CREATE INDEX IF NOT EXISTS qa_findings_course_idx
  ON qa_findings (catalog_course_id, created_at DESC);
CREATE INDEX IF NOT EXISTS qa_findings_invariant_idx ON qa_findings (invariant);

-- ---------------------------------------------------------------------------
-- Config
-- ---------------------------------------------------------------------------
-- The minimum-sample privacy floor is a HARD rule (specs/README.md), so it lives in the
-- database rather than in application code where it could be bypassed by a new call site.
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

INSERT INTO app_config (key, value)
VALUES ('min_sample', '5'::jsonb)
ON CONFLICT (key) DO NOTHING;
