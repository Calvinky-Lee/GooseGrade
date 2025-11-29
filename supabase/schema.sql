-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Courses table
CREATE TABLE IF NOT EXISTS courses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT NOT NULL,  -- e.g., "CS 135"
  name TEXT NOT NULL,
  department TEXT,  -- e.g., "CS"
  term TEXT NOT NULL,  -- e.g., "Fall 2024"
  term_date DATE NOT NULL, -- e.g., 2024-09-01 (First day of the term)
  outline_url TEXT,
  last_scraped TIMESTAMP DEFAULT NOW(),
  
  -- Ensure unique combination of course code, term, and outline URL (for multiple sections)
  CONSTRAINT unique_course_term_outline UNIQUE (code, term, outline_url)
);

-- Assessments table
CREATE TABLE IF NOT EXISTS assessments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,  -- e.g., "Quiz 1", "Midterm"
  category TEXT,  -- e.g., "Assignments", "Exams"
  weight DECIMAL(20,10) NOT NULL,  -- Individual weight percentage (e.g., 3.1818181818)
  total_weight DECIMAL(20,10) NOT NULL,  -- Total category weight (useful for reference)
  assessment_type TEXT NOT NULL,  -- "Assignment", "Midterm", "Final", etc.
  order_index INTEGER NOT NULL,  -- For display ordering
  term TEXT NOT NULL, -- e.g., "Fall 2024" (Duplicated from courses as requested)
  term_date DATE NOT NULL -- e.g., 2024-09-01 (Duplicated from courses as requested)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_courses_code ON courses(code);
CREATE INDEX IF NOT EXISTS idx_assessments_course_id ON assessments(course_id);

-- Row Level Security (RLS) policies
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessments ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for re-running)
DROP POLICY IF EXISTS "Public can read courses" ON courses;
DROP POLICY IF EXISTS "Public can read assessments" ON assessments;

-- Allow public read access to courses and assessments
CREATE POLICY "Public can read courses" ON courses
  FOR SELECT USING (true);

CREATE POLICY "Public can read assessments" ON assessments
  FOR SELECT USING (true);

