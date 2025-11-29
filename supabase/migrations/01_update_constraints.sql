-- Migration to support multiple course sections per term
-- Run this in your Supabase SQL Editor

-- 1. Drop the old unique constraint that prevented multiple sections
ALTER TABLE courses DROP CONSTRAINT IF EXISTS unique_course_term;

-- 2. Add a new constraint that includes the outline_url (unique per code + term + url)
ALTER TABLE courses ADD CONSTRAINT unique_course_term_outline UNIQUE (code, term, outline_url);

