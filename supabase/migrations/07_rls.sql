-- 07_rls.sql — Row-Level Security. specs/02-data-model.md §D.
--
-- Every user-table policy is literally `auth.uid() = user_id`. The DATABASE, not application
-- code, guarantees isolation — which is why a bug in lib/api cannot leak another student's
-- marks.

-- ---------------------------------------------------------------------------
-- Catalog: world-readable, service-role-writable
-- ---------------------------------------------------------------------------
ALTER TABLE catalog_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_assessments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS catalog_courses_read ON catalog_courses;
CREATE POLICY catalog_courses_read ON catalog_courses FOR SELECT USING (true);

DROP POLICY IF EXISTS catalog_assessments_read ON catalog_assessments;
CREATE POLICY catalog_assessments_read ON catalog_assessments FOR SELECT USING (true);

-- No INSERT/UPDATE/DELETE policies at all. With RLS enabled and no permissive policy, the
-- anon and authenticated roles simply cannot write — the service-role key bypasses RLS, so
-- the scraper still works. This is the structural fix for the v1 leak.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_own ON profiles;
CREATE POLICY profiles_own ON profiles
  FOR ALL USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- ---------------------------------------------------------------------------
-- User tables — one policy each, all the same shape
-- ---------------------------------------------------------------------------
ALTER TABLE user_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_assessments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_terms_own ON user_terms;
CREATE POLICY user_terms_own ON user_terms
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_courses_own ON user_courses;
CREATE POLICY user_courses_own ON user_courses
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_assessments_own ON user_assessments;
CREATE POLICY user_assessments_own ON user_assessments
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- shared_grades — write-only from the client's perspective
-- ---------------------------------------------------------------------------
ALTER TABLE shared_grades ENABLE ROW LEVEL SECURITY;

-- Deliberately NO SELECT policy. Reads happen exclusively through get_distribution(), which
-- is SECURITY DEFINER and enforces the minimum-sample floor. If a SELECT policy is ever added
-- here, the privacy guarantee is gone — the RLS test asserts its absence.
DROP POLICY IF EXISTS shared_grades_insert_own ON shared_grades;
CREATE POLICY shared_grades_insert_own ON shared_grades
  FOR INSERT WITH CHECK (contributor_id = auth.uid());

DROP POLICY IF EXISTS shared_grades_update_own ON shared_grades;
CREATE POLICY shared_grades_update_own ON shared_grades
  FOR UPDATE USING (contributor_id = auth.uid()) WITH CHECK (contributor_id = auth.uid());

DROP POLICY IF EXISTS shared_grades_delete_own ON shared_grades;
CREATE POLICY shared_grades_delete_own ON shared_grades
  FOR DELETE USING (contributor_id = auth.uid());

-- ---------------------------------------------------------------------------
-- feedback — insert-only
-- ---------------------------------------------------------------------------
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- Anonymous submission is allowed on purpose: the people most likely to report bad course
-- data are the ones who have not signed up. No SELECT policy — triage is service-role only.
DROP POLICY IF EXISTS feedback_insert_any ON feedback;
CREATE POLICY feedback_insert_any ON feedback
  FOR INSERT WITH CHECK (user_id IS NULL OR user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Pipeline provenance — public read so a student can see why a course is flagged
-- ---------------------------------------------------------------------------
ALTER TABLE scrape_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheme_diffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scrape_runs_read ON scrape_runs;
CREATE POLICY scrape_runs_read ON scrape_runs FOR SELECT USING (true);

DROP POLICY IF EXISTS scheme_diffs_read ON scheme_diffs;
CREATE POLICY scheme_diffs_read ON scheme_diffs FOR SELECT USING (true);

DROP POLICY IF EXISTS qa_findings_read ON qa_findings;
CREATE POLICY qa_findings_read ON qa_findings FOR SELECT USING (true);

-- app_config: no policy at all. min_sample is read only by the SECURITY DEFINER RPC, which
-- bypasses RLS. Exposing it would tell an attacker exactly how many fake contributions they
-- need to unlock a distribution.
