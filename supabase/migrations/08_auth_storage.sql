-- 08_auth_storage.sql — closes two gaps found in the spec audit (B0.3, B1.1).

-- ---------------------------------------------------------------------------
-- B0.3: the private `outlines` Storage bucket
-- ---------------------------------------------------------------------------
-- The scraper uploads cleaned outline text here and getOutlineSource() signs URLs from it.
-- Without the bucket, both fail at runtime — so it belongs in a migration rather than in a
-- setup instruction somebody has to remember.
INSERT INTO storage.buckets (id, name, public)
VALUES ('outlines', 'outlines', false)
ON CONFLICT (id) DO NOTHING;

-- Private on purpose. Reads go through a signed URL minted server-side by getOutlineSource,
-- which is what keeps the stored source auditable without making it a public mirror of
-- copyrighted course material. Only the service-role scraper writes.
DROP POLICY IF EXISTS outlines_service_write ON storage.objects;
CREATE POLICY outlines_service_write ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'outlines')
  WITH CHECK (bucket_id = 'outlines');

-- ---------------------------------------------------------------------------
-- B1.1: UW-email gating, enforced by the DATABASE
-- ---------------------------------------------------------------------------
-- Until now this lived only in TypeScript (assertUwEmail in packages/api). That is a UX
-- affordance, not a control: anyone calling the Supabase Auth endpoint directly bypasses it
-- entirely. specs/01 §Security and B1.1 both ask for an Auth hook AND a DB check.
--
-- This is the DB check. It runs as a BEFORE INSERT trigger on auth.users, so it applies to
-- every signup path — the app, a raw REST call, or the Supabase dashboard.
CREATE OR REPLACE FUNCTION enforce_uw_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Anonymous/service-created users have no email; leave those alone rather than blocking
  -- legitimate non-password auth flows.
  IF NEW.email IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.email !~* '@uwaterloo\.ca$' THEN
    -- The message is surfaced to the client, so it is written for a student to read. The code
    -- is matched by toApiError, which maps it onto auth/invalid-email.
    RAISE EXCEPTION 'auth/invalid-email: GooseGrade is for UWaterloo students — sign up with your @uwaterloo.ca address.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_uw_email_on_signup ON auth.users;
CREATE TRIGGER enforce_uw_email_on_signup
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION enforce_uw_email();

-- ---------------------------------------------------------------------------
-- Belt and braces on the profiles mirror
-- ---------------------------------------------------------------------------
-- handle_new_user() copies the email into profiles. If the trigger above is ever dropped, this
-- constraint still prevents a non-UW profile from existing. NOT VALID so it does not fail on
-- pre-existing rows from v1.
ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_uw_email_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_uw_email_check
    CHECK (email IS NULL OR email ~* '@uwaterloo\.ca$') NOT VALID;
