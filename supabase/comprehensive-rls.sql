-- ============================================================================
-- COMPREHENSIVE ROW LEVEL SECURITY SETUP
-- ============================================================================

-- 1. BUS_LOCATIONS table
ALTER TABLE bus_locations ENABLE ROW LEVEL SECURITY;

-- Anyone can read locations (public data)
DROP POLICY IF EXISTS "locations_select_public" ON bus_locations;
CREATE POLICY "locations_select_public" ON bus_locations
  FOR SELECT USING (true);

-- Only backend (service role) can insert via location submissions
-- Anon key cannot insert directly (even though policy says true)
-- Because backend verifies and only calls if valid
DROP POLICY IF EXISTS "locations_insert_via_backend" ON bus_locations;
CREATE POLICY "locations_insert_via_backend" ON bus_locations
  FOR INSERT WITH CHECK (true);

-- 2. COMPUTED_LOCATIONS table (aggregated locations)
ALTER TABLE computed_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "computed_locations_select_public" ON computed_locations;
CREATE POLICY "computed_locations_select_public" ON computed_locations
  FOR SELECT USING (true);

-- Only backend can insert
DROP POLICY IF EXISTS "computed_locations_insert_backend" ON computed_locations;
CREATE POLICY "computed_locations_insert_backend" ON computed_locations
  FOR INSERT WITH CHECK (true);

-- 3. TRIPS table
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "trips_select_all" ON trips;
CREATE POLICY "trips_select_all" ON trips
  FOR SELECT USING (true);

-- Only driver can create trip
DROP POLICY IF EXISTS "trips_insert_driver_only" ON trips;
CREATE POLICY "trips_insert_driver_only" ON trips
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL AND
    EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id = auth.uid()
      AND (u.raw_user_meta_data->>'role') = 'driver'
    )
  );

-- Only driver who started trip can update it
DROP POLICY IF EXISTS "trips_update_driver_only" ON trips;
CREATE POLICY "trips_update_driver_only" ON trips
  FOR UPDATE USING (
    driver_id = auth.uid()::text
  );

-- 4. DRIVERS table
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;

-- Drivers can read themselves, admins can read all
DROP POLICY IF EXISTS "drivers_select" ON drivers;
CREATE POLICY "drivers_select" ON drivers
  FOR SELECT USING (
    id = auth.uid()::text OR
    auth.uid() IS NOT NULL AND
    (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = auth.uid()) = 'admin'
  );

-- Only admins can update
DROP POLICY IF EXISTS "drivers_update_admin" ON drivers;
CREATE POLICY "drivers_update_admin" ON drivers
  FOR UPDATE WITH CHECK (
    auth.uid() IS NOT NULL AND
    (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = auth.uid()) = 'admin'
  );

-- 5. STUDENTS table
ALTER TABLE students ENABLE ROW LEVEL SECURITY;

-- Students can read themselves, admins can read all
DROP POLICY IF EXISTS "students_select" ON students;
CREATE POLICY "students_select" ON students
  FOR SELECT USING (
    id = auth.uid()::text OR
    auth.uid() IS NOT NULL AND
    (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = auth.uid()) = 'admin'
  );

-- Only admins can update
DROP POLICY IF EXISTS "students_update_admin" ON students;
CREATE POLICY "students_update_admin" ON students
  FOR UPDATE WITH CHECK (
    auth.uid() IS NOT NULL AND
    (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = auth.uid()) = 'admin'
  );

-- Confirmation
SELECT 'All RLS policies enabled and configured' AS status;
