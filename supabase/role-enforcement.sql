-- ============================================================================
-- ROLE ENFORCEMENT — AUTHORITATIVE SERVER-SIDE SETUP
-- ============================================================================
-- ARCHITECTURE DECISION:
--   Roles are stored in auth.users.raw_app_meta_data (app_metadata), NOT in
--   raw_user_meta_data (user_metadata). This is critical because:
--     - app_metadata is WRITE-PROTECTED from the client-side Supabase SDK
--     - Only the service_role key (used by our backend) can set app_metadata
--     - user_metadata CAN be written by the client — never trust it for authz
--
--   Pattern used:
--     auth.users.raw_app_meta_data->>'role'   <- ground truth, backend-only
--
-- HOW TO ASSIGN ROLES:
--   Use the Supabase Admin API (service_role) from your backend, e.g.:
--     await supabase.auth.admin.updateUserById(userId, {
--       app_metadata: { role: 'driver' }   // 'admin', 'driver', 'student'
--     })
--
--   The user's display name or email can change without affecting this UUID-
--   bound role. Renaming "Driver 1" to "Alex" never breaks authorization.
-- ============================================================================

-- ===========================================================================
-- 1. SECURITY DEFINER HELPER FUNCTIONS
--    These bypass RLS when called, but only expose the minimum needed info.
-- ===========================================================================

-- Returns the role from app_metadata for any given user UUID
CREATE OR REPLACE FUNCTION public.get_user_role(user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT raw_app_meta_data->>'role'
  FROM auth.users
  WHERE id = user_id;
$$;

-- Convenience: returns the current authenticated user's role
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_user_role(auth.uid());
$$;

-- Checks if the current user has a specific role (for use in RLS policies)
CREATE OR REPLACE FUNCTION public.has_role(required_role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_user_role() = required_role;
$$;

-- Checks if current user is admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role('admin');
$$;

-- Checks if current user is a driver
CREATE OR REPLACE FUNCTION public.is_driver()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role('driver');
$$;

-- Checks if current user is a student, parent, or teacher
CREATE OR REPLACE FUNCTION public.is_public_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_user_role() IN ('student', 'parent', 'teacher', 'faculty');
$$;

-- ===========================================================================
-- 2. BUS_LOCATIONS
-- ===========================================================================
ALTER TABLE bus_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bus_locations_select_public" ON bus_locations;
CREATE POLICY "bus_locations_select_public" ON bus_locations
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "bus_locations_insert_deny_direct" ON bus_locations;
CREATE POLICY "bus_locations_insert_deny_direct" ON bus_locations
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS "bus_locations_update_deny_direct" ON bus_locations;
CREATE POLICY "bus_locations_update_deny_direct" ON bus_locations
  FOR UPDATE USING (false);

DROP POLICY IF EXISTS "bus_locations_delete_deny_direct" ON bus_locations;
CREATE POLICY "bus_locations_delete_deny_direct" ON bus_locations
  FOR DELETE USING (false);

-- ===========================================================================
-- 3. COMPUTED_LOCATIONS
-- ===========================================================================
ALTER TABLE computed_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "computed_locations_select_public" ON computed_locations;
CREATE POLICY "computed_locations_select_public" ON computed_locations
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "computed_locations_insert_deny" ON computed_locations;
CREATE POLICY "computed_locations_insert_deny" ON computed_locations
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS "computed_locations_update_deny" ON computed_locations;
CREATE POLICY "computed_locations_update_deny" ON computed_locations
  FOR UPDATE USING (false);

-- ===========================================================================
-- 4. TRIPS
-- ===========================================================================
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "trips_select_public" ON trips;
CREATE POLICY "trips_select_public" ON trips
  FOR SELECT USING (true);

-- Only a verified driver can create a trip, AND they must own it
DROP POLICY IF EXISTS "trips_insert_driver_only" ON trips;
CREATE POLICY "trips_insert_driver_only" ON trips
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND public.is_driver()
    AND driver_id = auth.uid()
  );

-- Only the owning driver can update their trip
DROP POLICY IF EXISTS "trips_update_owner_driver" ON trips;
CREATE POLICY "trips_update_owner_driver" ON trips
  FOR UPDATE
  USING (driver_id = auth.uid() AND public.is_driver());

-- Admins can update any trip (e.g., force-end a stuck trip)
DROP POLICY IF EXISTS "trips_update_admin" ON trips;
CREATE POLICY "trips_update_admin" ON trips
  FOR UPDATE
  USING (public.is_admin());

DROP POLICY IF EXISTS "trips_delete_admin" ON trips;
CREATE POLICY "trips_delete_admin" ON trips
  FOR DELETE USING (public.is_admin());

-- ===========================================================================
-- 5. DRIVERS TABLE
-- ===========================================================================
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "drivers_select_own_or_admin" ON drivers;
CREATE POLICY "drivers_select_own_or_admin" ON drivers
  FOR SELECT
  USING (id = auth.uid() OR public.is_admin());

-- Only admins can insert / update / delete driver profiles
-- (A driver cannot change their own assignedBus or impersonate another driver)
DROP POLICY IF EXISTS "drivers_insert_admin" ON drivers;
CREATE POLICY "drivers_insert_admin" ON drivers
  FOR INSERT WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "drivers_update_admin" ON drivers;
CREATE POLICY "drivers_update_admin" ON drivers
  FOR UPDATE WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "drivers_delete_admin" ON drivers;
CREATE POLICY "drivers_delete_admin" ON drivers
  FOR DELETE USING (public.is_admin());

-- ===========================================================================
-- 6. STUDENTS TABLE
-- ===========================================================================
ALTER TABLE students ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "students_select_own_or_admin" ON students;
CREATE POLICY "students_select_own_or_admin" ON students
  FOR SELECT
  USING (id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "students_insert_admin" ON students;
CREATE POLICY "students_insert_admin" ON students
  FOR INSERT WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "students_update_admin" ON students;
CREATE POLICY "students_update_admin" ON students
  FOR UPDATE WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "students_delete_admin" ON students;
CREATE POLICY "students_delete_admin" ON students
  FOR DELETE USING (public.is_admin());

-- ===========================================================================
-- 7. SOS_EVENTS (uncomment and adjust table name as needed)
-- ===========================================================================
-- ALTER TABLE sos_events ENABLE ROW LEVEL SECURITY;
--
-- DROP POLICY IF EXISTS "sos_insert_authenticated" ON sos_events;
-- CREATE POLICY "sos_insert_authenticated" ON sos_events
--   FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
--
-- DROP POLICY IF EXISTS "sos_select_admin_or_own" ON sos_events;
-- CREATE POLICY "sos_select_admin_or_own" ON sos_events
--   FOR SELECT USING (public.is_admin() OR reporter_id = auth.uid());
--
-- DROP POLICY IF EXISTS "sos_update_admin" ON sos_events;
-- CREATE POLICY "sos_update_admin" ON sos_events
--   FOR UPDATE WITH CHECK (public.is_admin());

-- ===========================================================================
-- 8. VALIDATION — run after applying to confirm RLS is enabled on all tables
-- ===========================================================================
SELECT
  schemaname,
  tablename,
  rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'bus_locations', 'computed_locations', 'trips', 'drivers', 'students'
  )
ORDER BY tablename;
