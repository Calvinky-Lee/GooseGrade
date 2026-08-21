-- 04_user_tables.sql — per-user data, all RLS-protected.
--
-- specs/02-data-model.md §B. Every row here belongs to exactly one user, and the DATABASE —
-- not application code — guarantees the isolation (policies land in 07_rls.sql).

-- ---------------------------------------------------------------------------
-- profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  faculty TEXT,
  program TEXT,
  current_level TEXT,
  -- { contributeDistributions: bool, theme: 'light'|'dark' }
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- user_terms
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_terms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  term_label TEXT NOT NULL,
  term_date DATE NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_terms_user_date_idx
  ON user_terms (user_id, term_date DESC);

-- specs/02 says "exactly one current term per user (enforced in app/RPC)". Enforcing it here
-- instead: a partial unique index makes it impossible to end up with two, which an app-level
-- check cannot promise under concurrent writes.
CREATE UNIQUE INDEX IF NOT EXISTS user_terms_one_current_per_user
  ON user_terms (user_id) WHERE is_current;

-- ---------------------------------------------------------------------------
-- user_courses — the forked, editable copy
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_courses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  user_term_id UUID NOT NULL REFERENCES user_terms (id) ON DELETE CASCADE,
  -- Nullable: a fully custom course has no catalog source. ON DELETE SET NULL so a catalog
  -- row disappearing never destroys a student's record of their own marks.
  catalog_course_id UUID REFERENCES catalog_courses (id) ON DELETE SET NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  section TEXT,
  credit_weight NUMERIC(3, 2) NOT NULL DEFAULT 0.50,
  grade_basis TEXT NOT NULL DEFAULT 'numeric',
  -- Forked copy of the catalog's rules. The user may toggle or add to these freely; this is
  -- the layered override that keeps their edits off the shared catalog.
  grading_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  rules_overridden BOOLEAN NOT NULL DEFAULT false,
  target_grade NUMERIC(5, 2),
  color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT user_courses_grade_basis_check CHECK (grade_basis IN ('numeric', 'cr_ncr')),
  CONSTRAINT user_courses_credit_weight_check CHECK (credit_weight > 0)
);

CREATE INDEX IF NOT EXISTS user_courses_user_term_idx
  ON user_courses (user_id, user_term_id);

-- Backs the `course/already-added` error code in specs/04 §7 at the database level.
CREATE UNIQUE INDEX IF NOT EXISTS user_courses_term_catalog_key
  ON user_courses (user_term_id, catalog_course_id)
  WHERE catalog_course_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- user_assessments — forked, editable, and where the marks actually live
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_assessments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  user_course_id UUID NOT NULL REFERENCES user_courses (id) ON DELETE CASCADE,
  catalog_assessment_id UUID REFERENCES catalog_assessments (id) ON DELETE SET NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  assessment_type TEXT NOT NULL,
  weight NUMERIC(20, 10) NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  -- The student's mark. NULL means not entered — never 0, which would be a real failing mark.
  grade NUMERIC(7, 4),
  status TEXT NOT NULL DEFAULT 'upcoming',
  is_custom BOOLEAN NOT NULL DEFAULT false,
  -- Soft-remove keeps the slug and the catalog reference, so "reset to official" can restore
  -- the item and distributions keep resolving.
  is_removed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- `status` is the correctness keystone: 'excused' removes the weight from the denominator,
  -- 'missed' is a real zero. That distinction is what prevents wrongly failing a student.
  CONSTRAINT user_assessments_status_check
    CHECK (status IN ('upcoming', 'graded', 'excused', 'missed')),
  CONSTRAINT user_assessments_course_slug_key UNIQUE (user_course_id, slug)
);

CREATE INDEX IF NOT EXISTS user_assessments_user_course_idx
  ON user_assessments (user_id, user_course_id);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_courses_set_updated_at ON user_courses;
CREATE TRIGGER user_courses_set_updated_at
  BEFORE UPDATE ON user_courses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS user_assessments_set_updated_at ON user_assessments;
CREATE TRIGGER user_assessments_set_updated_at
  BEFORE UPDATE ON user_assessments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Auto-create a profile on signup (specs/02 §E)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
