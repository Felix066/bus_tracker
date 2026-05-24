-- BusTrack Admin Console Schema Extension
-- Run this script in the Supabase SQL Editor

-- 1. Enable pgcrypto for secure password hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Create Admins Table
CREATE TABLE IF NOT EXISTS admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- 3. Create Buses Table
CREATE TABLE IF NOT EXISTS buses (
  id text PRIMARY KEY, -- e.g., 'Bus 1'
  driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL,
  status text CHECK (status IN ('active', 'inactive', 'maintenance')) DEFAULT 'active',
  created_at timestamptz DEFAULT now()
);

-- 4. Update Drivers Table
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS driver_name text;

-- 5. Seed Admins securely (using crypt and gen_salt)
-- Clear existing to avoid unique constraint errors during dev runs
TRUNCATE TABLE admins CASCADE;
INSERT INTO admins (username, password_hash) VALUES 
  ('admin', crypt('admin123', gen_salt('bf'))),
  ('admin1', crypt('password123', gen_salt('bf')));

-- 6. Populate default buses
INSERT INTO buses (id, status) VALUES 
  ('Bus 1', 'active'),
  ('Bus 2', 'active'),
  ('Bus 3', 'active'),
  ('Bus 4', 'active'),
  ('Bus 5', 'active'),
  ('Bus 6', 'active')
ON CONFLICT (id) DO NOTHING;

-- 7. Update existing drivers with default driver names
UPDATE drivers SET driver_name = username WHERE driver_name IS NULL;

-- 8. Assign buses to existing drivers (linking them together)
DO $$ 
DECLARE
  drv RECORD;
BEGIN
  FOR drv IN SELECT id, assigned_bus FROM drivers LOOP
    UPDATE buses SET driver_id = drv.id WHERE id = drv.assigned_bus;
  END LOOP;
END $$;

-- 9. Create Secure Login RPC Function
-- This prevents SQL injection and keeps password hashes purely on the server side
CREATE OR REPLACE FUNCTION admin_login(p_username text, p_password text)
RETURNS boolean AS $$
DECLARE
  is_valid boolean;
BEGIN
  SELECT (password_hash = crypt(p_password, password_hash)) INTO is_valid
  FROM admins
  WHERE username = p_username;
  
  RETURN COALESCE(is_valid, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 10. Enable RLS and Policies for new tables
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE buses ENABLE ROW LEVEL SECURITY;

-- Admins can only be queried by service role or authenticated admins
CREATE POLICY "buses_select_policy" ON buses FOR SELECT USING (true);
CREATE POLICY "buses_all_policy" ON buses FOR ALL USING (true);

-- End of script
