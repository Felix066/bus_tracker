-- 1. Remove old authentication-related objects
-- Drop the trigger and function that automatically created profiles
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users CASCADE;
DROP FUNCTION IF EXISTS handle_new_user() CASCADE;

-- Drop the profiles table as it's no longer used for student/faculty roles
DROP TABLE IF EXISTS profiles CASCADE;

-- Optionally, you can also drop the invitations table if it was only used for old auth:
-- DROP TABLE IF EXISTS invitations CASCADE;

-- 2. Create or Update the students and faculty tables
CREATE TABLE IF NOT EXISTS students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE students ADD COLUMN IF NOT EXISTS email text UNIQUE;

CREATE TABLE IF NOT EXISTS faculty (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE faculty ADD COLUMN IF NOT EXISTS email text UNIQUE;

-- 3. Enable RLS on the new tables
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE faculty ENABLE ROW LEVEL SECURITY;

-- 4. Create RLS policies for backend access
-- Since only the backend using the service role key will access these tables,
-- we don't strictly need public access policies. But we'll add a baseline policy.
CREATE POLICY "students_select_policy" ON students FOR SELECT USING (true);
CREATE POLICY "faculty_select_policy" ON faculty FOR SELECT USING (true);

-- 5. Insert the test data as requested
-- We explicitly set the id to gen_random_uuid() in case the existing table's id column lacks a DEFAULT value.
INSERT INTO students (id, email) VALUES (gen_random_uuid(), 'felixdaniejose06@gmail.com')
ON CONFLICT (email) DO NOTHING;

INSERT INTO faculty (id, email) VALUES (gen_random_uuid(), 'felixdaniejose06@gmail.com')
ON CONFLICT (email) DO NOTHING;
