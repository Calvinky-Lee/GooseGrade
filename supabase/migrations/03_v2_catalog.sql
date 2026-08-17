-- 03_v2_catalog.sql — rename v1 tables into the v2 catalog and extend them.
--
-- specs/02-data-model.md §A, §F. The catalog is canonical, scraped, and READ-ONLY to every
-- user: the fix for the v1 bug where a rename wrote to the shared table and leaked to
-- everyone. Only the service-role scraper writes here.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Rename, preserving data. v1 already treats each section/outline as a row.
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS courses RENAME TO catalog_courses;
ALTER TABLE IF EXISTS assessments RENAME TO catalog_assessments;

-- ---------------------------------------------------------------------------
-- catalog_courses: new columns
-- ---------------------------------------------------------------------------
ALTER TABLE catalog_courses
  ADD COLUMN IF NOT EXISTS section TEXT,
  -- UW credit value. Drives credit-weighted averages, so it must never be null.
  ADD COLUMN IF NOT EXISTS credit_weight NUMERIC(3, 2) NOT NULL DEFAULT 0.50,
  ADD COLUMN IF NOT EXISTS grade_basis TEXT NOT NULL DEFAULT 'numeric',
  -- Array of GradingRule (specs/03 §2). JSONB because the shape is a discriminated union
  -- that the engine, not Postgres, is responsible for interpreting.
  ADD COLUMN IF NOT EXISTS grading_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS scheme_confidence TEXT NOT NULL DEFAULT 'unconfirmed',
  ADD COLUMN IF NOT EXISTS outline_storage_path TEXT,
  -- Hash of the cleaned outline text. Re-scrape skips unchanged outlines, which is what
  -- keeps recurring extraction cost far below the first run.
  ADD COLUMN IF NOT EXISTS source_hash TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE catalog_courses
  ADD CONSTRAINT catalog_courses_grade_basis_check
    CHECK (grade_basis IN ('numeric', 'cr_ncr')) NOT VALID;

ALTER TABLE catalog_courses
  ADD CONSTRAINT catalog_courses_scheme_confidence_check
    CHECK (scheme_confidence IN ('unconfirmed', 'review', 'verified')) NOT VALID;

-- Credit weight must be positive — a 0-credit course would divide by zero in the average.
ALTER TABLE catalog_courses
  ADD CONSTRAINT catalog_courses_credit_weight_check
    CHECK (credit_weight > 0) NOT VALID;

CREATE INDEX IF NOT EXISTS catalog_courses_code_idx ON catalog_courses (code);
CREATE INDEX IF NOT EXISTS catalog_courses_term_date_idx ON catalog_courses (term_date DESC);
CREATE INDEX IF NOT EXISTS catalog_courses_department_idx ON catalog_courses (department);

-- ---------------------------------------------------------------------------
-- catalog_assessments: stable slugs
-- ---------------------------------------------------------------------------
-- The slug is the load-bearing addition. It survives re-scrapes AND the catalog->user fork,
-- which is what lets rule references and crowd distributions keep pointing at the right item
-- after a student renames it.
ALTER TABLE catalog_assessments
  ADD COLUMN IF NOT EXISTS slug TEXT,
  ADD COLUMN IF NOT EXISTS order_index INTEGER NOT NULL DEFAULT 0;

-- Backfill slugs for existing rows: slugify(name), de-duplicated within each course.
WITH numbered AS (
  SELECT
    id,
    course_id,
    regexp_replace(
      regexp_replace(lower(coalesce(name, 'item')), '[^a-z0-9]+', '-', 'g'),
      '(^-|-$)', '', 'g'
    ) AS base,
    row_number() OVER (
      PARTITION BY course_id,
        regexp_replace(
          regexp_replace(lower(coalesce(name, 'item')), '[^a-z0-9]+', '-', 'g'),
          '(^-|-$)', '', 'g'
        )
      ORDER BY id
    ) AS dup_rank
  FROM catalog_assessments
  WHERE slug IS NULL
)
UPDATE catalog_assessments a
SET slug = CASE
             WHEN n.base = '' THEN 'item-' || n.dup_rank
             WHEN n.dup_rank = 1 THEN n.base
             ELSE n.base || '-' || n.dup_rank
           END
FROM numbered n
WHERE a.id = n.id;

-- Backfill display order from the existing name ordering.
WITH ordered AS (
  SELECT id, row_number() OVER (PARTITION BY course_id ORDER BY name) AS rn
  FROM catalog_assessments
)
UPDATE catalog_assessments a
SET order_index = ordered.rn
FROM ordered
WHERE a.id = ordered.id AND a.order_index = 0;

ALTER TABLE catalog_assessments ALTER COLUMN slug SET NOT NULL;

-- Unique within a course, not globally: two courses may both have "final-exam".
ALTER TABLE catalog_assessments
  ADD CONSTRAINT catalog_assessments_course_slug_key UNIQUE (course_id, slug);

CREATE INDEX IF NOT EXISTS catalog_assessments_course_id_idx
  ON catalog_assessments (course_id);
