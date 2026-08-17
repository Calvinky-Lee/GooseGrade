-- 06_rpcs_triggers.sql — the RPCs from specs/02 §E.
--
-- These are the operations that must be atomic or must run with elevated privilege. Everything
-- else stays a plain RLS-protected query, per specs/01: no 24/7 API service.

-- ---------------------------------------------------------------------------
-- fork_catalog_course — the fix for the v1 shared-catalog bug
-- ---------------------------------------------------------------------------
-- Copies a catalog course and its assessments into the caller's own rows. The catalog is never
-- mutated by a user action; in v1 a rename wrote to the shared table and leaked to everyone.
CREATE OR REPLACE FUNCTION fork_catalog_course(
  p_catalog_course_id UUID,
  p_user_term_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER  -- deliberately INVOKER: RLS must still apply to the inserts below.
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_course_id UUID;
  v_catalog RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth/unauthorized' USING ERRCODE = '42501';
  END IF;

  -- The term must belong to the caller. Without this check a user could fork into someone
  -- else's term id.
  IF NOT EXISTS (
    SELECT 1 FROM user_terms WHERE id = p_user_term_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'auth/unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_catalog FROM catalog_courses WHERE id = p_catalog_course_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'validation/catalog-course-not-found' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM user_courses
    WHERE user_term_id = p_user_term_id AND catalog_course_id = p_catalog_course_id
  ) THEN
    RAISE EXCEPTION 'course/already-added' USING ERRCODE = '23505';
  END IF;

  INSERT INTO user_courses (
    user_id, user_term_id, catalog_course_id, code, name, section,
    credit_weight, grade_basis, grading_rules, rules_overridden
  )
  VALUES (
    v_user_id, p_user_term_id, p_catalog_course_id, v_catalog.code, v_catalog.name,
    v_catalog.section, v_catalog.credit_weight, v_catalog.grade_basis,
    v_catalog.grading_rules, false
  )
  RETURNING id INTO v_course_id;

  INSERT INTO user_assessments (
    user_id, user_course_id, catalog_assessment_id, slug, name, category,
    assessment_type, weight, order_index, status
  )
  SELECT
    v_user_id, v_course_id, ca.id, ca.slug, ca.name, ca.category,
    ca.assessment_type, ca.weight, ca.order_index, 'upcoming'
  FROM catalog_assessments ca
  WHERE ca.course_id = p_catalog_course_id;

  RETURN v_course_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- reset_course_to_catalog
-- ---------------------------------------------------------------------------
-- Re-copies rules and assessments from the source catalog course, PRESERVING entered marks by
-- slug. Losing a student's marks to a "reset rules" action would be unforgivable, so the
-- match is on the stable slug rather than on row identity.
CREATE OR REPLACE FUNCTION reset_course_to_catalog(p_user_course_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_catalog_id UUID;
BEGIN
  SELECT catalog_course_id INTO v_catalog_id
  FROM user_courses
  WHERE id = p_user_course_id AND user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'auth/unauthorized' USING ERRCODE = '42501';
  END IF;

  IF v_catalog_id IS NULL THEN
    RAISE EXCEPTION 'validation/no-catalog-source' USING ERRCODE = '22023';
  END IF;

  UPDATE user_courses uc
  SET grading_rules = cc.grading_rules,
      rules_overridden = false,
      credit_weight = cc.credit_weight,
      grade_basis = cc.grade_basis
  FROM catalog_courses cc
  WHERE uc.id = p_user_course_id AND cc.id = v_catalog_id;

  -- Restore catalog items: re-add anything missing, un-remove anything soft-removed, and reset
  -- names/weights — but never touch `grade` or `status`.
  INSERT INTO user_assessments (
    user_id, user_course_id, catalog_assessment_id, slug, name, category,
    assessment_type, weight, order_index, status
  )
  SELECT
    v_user_id, p_user_course_id, ca.id, ca.slug, ca.name, ca.category,
    ca.assessment_type, ca.weight, ca.order_index, 'upcoming'
  FROM catalog_assessments ca
  WHERE ca.course_id = v_catalog_id
  ON CONFLICT (user_course_id, slug) DO UPDATE
    SET name = EXCLUDED.name,
        category = EXCLUDED.category,
        assessment_type = EXCLUDED.assessment_type,
        weight = EXCLUDED.weight,
        order_index = EXCLUDED.order_index,
        is_removed = false;

  -- User-added items are not part of the official scheme, so a reset removes them — but
  -- softly, so the action stays recoverable.
  UPDATE user_assessments
  SET is_removed = true
  WHERE user_course_id = p_user_course_id AND is_custom = true;
END;
$$;

-- ---------------------------------------------------------------------------
-- rollover_term
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rollover_term(
  p_from_term_id UUID,
  p_new_label TEXT,
  p_new_term_date DATE,
  p_clone_courses BOOLEAN DEFAULT false
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_new_term_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth/unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Clear the current flag first: the partial unique index in 04 makes two current terms
  -- impossible, so this ordering matters.
  UPDATE user_terms SET is_current = false
  WHERE user_id = v_user_id AND is_current;

  INSERT INTO user_terms (user_id, term_label, term_date, is_current)
  VALUES (v_user_id, p_new_label, p_new_term_date, true)
  RETURNING id INTO v_new_term_id;

  IF p_clone_courses AND p_from_term_id IS NOT NULL THEN
    -- Clone course SHELLS only: same courses, no marks. A rollover that carried last term's
    -- grades forward would corrupt the new term's average.
    INSERT INTO user_courses (
      user_id, user_term_id, catalog_course_id, code, name, section,
      credit_weight, grade_basis, grading_rules, rules_overridden, target_grade, color
    )
    SELECT
      v_user_id, v_new_term_id, catalog_course_id, code, name, section,
      credit_weight, grade_basis, grading_rules, rules_overridden, target_grade, color
    FROM user_courses
    WHERE user_term_id = p_from_term_id AND user_id = v_user_id;
  END IF;

  RETURN v_new_term_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- get_distribution — the only read path into shared_grades
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER because clients have no SELECT on shared_grades at all. The minimum-sample
-- floor is enforced HERE rather than in application code, so no future call site can bypass it.
CREATE OR REPLACE FUNCTION get_distribution(
  p_catalog_course_id UUID,
  p_slug TEXT,
  p_term TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_min_sample INTEGER;
  v_count INTEGER;
  v_mean NUMERIC;
  v_median NUMERIC;
  v_buckets JSONB;
  v_my_grade NUMERIC;
  v_my_percentile NUMERIC;
  v_p05 NUMERIC;
  v_p95 NUMERIC;
BEGIN
  SELECT (value::text)::INTEGER INTO v_min_sample FROM app_config WHERE key = 'min_sample';
  v_min_sample := coalesce(v_min_sample, 5);

  -- Trim outliers before aggregating, so one fabricated 150 cannot skew a small sample.
  SELECT
    percentile_cont(0.05) WITHIN GROUP (ORDER BY grade),
    percentile_cont(0.95) WITHIN GROUP (ORDER BY grade)
  INTO v_p05, v_p95
  FROM shared_grades
  WHERE catalog_course_id = p_catalog_course_id
    AND term = p_term
    AND slug IS NOT DISTINCT FROM p_slug;

  CREATE TEMP TABLE IF NOT EXISTS _dist (grade NUMERIC) ON COMMIT DROP;
  DELETE FROM _dist;

  INSERT INTO _dist (grade)
  SELECT grade FROM shared_grades
  WHERE catalog_course_id = p_catalog_course_id
    AND term = p_term
    AND slug IS NOT DISTINCT FROM p_slug
    AND (v_p05 IS NULL OR grade BETWEEN v_p05 AND v_p95);

  SELECT count(*), avg(grade), percentile_cont(0.5) WITHIN GROUP (ORDER BY grade)
  INTO v_count, v_mean, v_median
  FROM _dist;

  -- The hard privacy floor. Below it we return nothing at all — not a rounded number, not a
  -- bucket count, nothing that could identify an individual's mark.
  IF v_count IS NULL OR v_count < v_min_sample THEN
    RETURN jsonb_build_object(
      'available', false,
      'count', 0,
      'term', p_term
    );
  END IF;

  SELECT jsonb_agg(
           jsonb_build_object('rangeLow', lo, 'rangeHigh', lo + 10, 'count', c)
           ORDER BY lo
         )
  INTO v_buckets
  FROM (
    SELECT (floor(grade / 10) * 10)::INTEGER AS lo, count(*) AS c
    FROM _dist
    GROUP BY 1
  ) b;

  -- The caller's own standing, computed here so their grade never leaves the database.
  SELECT grade INTO v_my_grade
  FROM shared_grades
  WHERE catalog_course_id = p_catalog_course_id
    AND term = p_term
    AND slug IS NOT DISTINCT FROM p_slug
    AND contributor_id = auth.uid();

  IF v_my_grade IS NOT NULL THEN
    SELECT round((count(*) FILTER (WHERE grade <= v_my_grade)::NUMERIC / count(*)) * 100, 1)
    INTO v_my_percentile
    FROM _dist;
  END IF;

  RETURN jsonb_build_object(
    'available', true,
    'count', v_count,
    'mean', round(v_mean, 2),
    'median', round(v_median, 2),
    'buckets', coalesce(v_buckets, '[]'::jsonb),
    'myPercentile', v_my_percentile,
    'term', p_term
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- delete_account — backs the privacy requirement
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION delete_account()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth/unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Everything else cascades from auth.users, including this user's shared_grades. Deleting
  -- the auth row is therefore the complete deletion, which is what makes the promise honest.
  DELETE FROM auth.users WHERE id = v_user_id;
END;
$$;

REVOKE ALL ON FUNCTION get_distribution(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_distribution(UUID, TEXT, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION delete_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_account() TO authenticated;
