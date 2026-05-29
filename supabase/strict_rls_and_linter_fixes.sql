-- supabase/strict_rls_and_linter_fixes.sql
-- Run this script in the Supabase SQL editor to secure the database and resolve linter warnings.

-- ============================================================================
-- 1. FIX MUTABLE FUNCTION SEARCH PATHS (Linter: function_search_path_mutable)
-- ============================================================================
ALTER FUNCTION public.handle_new_user SET search_path = public;
ALTER FUNCTION public.admin_login SET search_path = public;
ALTER FUNCTION public.verify_driver SET search_path = public;
ALTER FUNCTION public.rate_limit_location_submission SET search_path = public;
ALTER FUNCTION public.validate_location_submission SET search_path = public;

-- ============================================================================
-- 2. DROP ALL PERMISSIVE RLS POLICIES (Linter: rls_policy_always_true)
-- ============================================================================
-- We now use the Node.js backend (service_role key) for all mutations.
-- The anon and authenticated keys in the browser should NEVER be allowed to INSERT/UPDATE/DELETE directly.

-- Admin Logs
DROP POLICY IF EXISTS "Enable delete for all" ON public.admin_logs;
DROP POLICY IF EXISTS "Enable insert for all" ON public.admin_logs;

-- Bus Locations (Historical)
DROP POLICY IF EXISTS "bus_locations_insert_policy" ON public.bus_locations;

-- Buses
DROP POLICY IF EXISTS "Admins can delete buses" ON public.buses;
DROP POLICY IF EXISTS "Admins can insert buses" ON public.buses;
DROP POLICY IF EXISTS "Admins can update buses" ON public.buses;
DROP POLICY IF EXISTS "buses_all_policy" ON public.buses;

-- Computed Locations
DROP POLICY IF EXISTS "computed_locations_insert_policy" ON public.computed_locations;

-- Current Bus Locations
DROP POLICY IF EXISTS "Drivers can update locations" ON public.current_bus_locations;
DROP POLICY IF EXISTS "Drivers can upsert locations" ON public.current_bus_locations;
DROP POLICY IF EXISTS "current_bus_locations_insert" ON public.current_bus_locations;
DROP POLICY IF EXISTS "current_bus_locations_update" ON public.current_bus_locations;

-- Driver Sessions
DROP POLICY IF EXISTS "Admins can delete sessions" ON public.driver_sessions;
DROP POLICY IF EXISTS "Drivers can update sessions" ON public.driver_sessions;
DROP POLICY IF EXISTS "Drivers can upsert sessions" ON public.driver_sessions;
DROP POLICY IF EXISTS "Enable all for everyone" ON public.driver_sessions;

-- Drivers
DROP POLICY IF EXISTS "Backend can access drivers table" ON public.drivers;

-- SOS Alerts
DROP POLICY IF EXISTS "Enable insert for all" ON public.sos_alerts;
DROP POLICY IF EXISTS "Enable update for all" ON public.sos_alerts;

-- Stop Arrivals
DROP POLICY IF EXISTS "stop_arrivals_insert_policy" ON public.stop_arrivals;

-- Trips
DROP POLICY IF EXISTS "Drivers can insert trips" ON public.trips;
DROP POLICY IF EXISTS "Drivers can update trips" ON public.trips;
DROP POLICY IF EXISTS "trips_all_drivers_policy" ON public.trips;


-- ============================================================================
-- 3. ENSURE READ-ONLY POLICIES FOR PUBLIC (Required for Student Portal)
-- ============================================================================
-- (These will not trigger the linter because USING(true) is allowed for SELECT)

DROP POLICY IF EXISTS "Public can view buses" ON public.buses;
CREATE POLICY "Public can view buses" ON public.buses FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public can view trips" ON public.trips;
CREATE POLICY "Public can view trips" ON public.trips FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public can view sessions" ON public.driver_sessions;
CREATE POLICY "Public can view sessions" ON public.driver_sessions FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public can view locations" ON public.current_bus_locations;
CREATE POLICY "Public can view locations" ON public.current_bus_locations FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public can view stop arrivals" ON public.stop_arrivals;
CREATE POLICY "Public can view stop arrivals" ON public.stop_arrivals FOR SELECT USING (true);


-- ============================================================================
-- 4. REVOKE GRAPHQL EXPOSURE FOR SENSITIVE TABLES (Linter: pg_graphql_anon_table_exposed)
-- ============================================================================
-- To stop the linter from complaining about internal tables being accessible via the 
-- public GraphQL schema, we revoke SELECT access to anon/authenticated for tables 
-- that shouldn't be publicly queried.

REVOKE SELECT ON public.admin_logs FROM anon, authenticated;
REVOKE SELECT ON public.admins FROM anon, authenticated;
REVOKE SELECT ON public.drivers FROM anon, authenticated;
REVOKE SELECT ON public.profiles FROM anon, authenticated;
REVOKE SELECT ON public.sos_alerts FROM anon, authenticated;
