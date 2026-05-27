-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES & TABLE CREATION
-- ============================================================================

-- 0. CREATE CURRENT_BUS_LOCATIONS TABLE
CREATE TABLE IF NOT EXISTS current_bus_locations (
    bus_id TEXT PRIMARY KEY,
    trip_id UUID,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    speed_kmh DOUBLE PRECISION DEFAULT 0,
    source_role TEXT,
    source_user_id TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS on the table
ALTER TABLE current_bus_locations ENABLE ROW LEVEL SECURITY;

-- 1. CURRENT_BUS_LOCATIONS TABLE - INSERT/UPDATE policy

DROP POLICY IF EXISTS "current_bus_locations_insert" ON current_bus_locations;
CREATE POLICY "current_bus_locations_insert" ON current_bus_locations
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "current_bus_locations_update" ON current_bus_locations;
CREATE POLICY "current_bus_locations_update" ON current_bus_locations
  FOR UPDATE USING (true) WITH CHECK (true);

-- 2. CURRENT_BUS_LOCATIONS TABLE - SELECT policy
DROP POLICY IF EXISTS "current_bus_locations_select" ON current_bus_locations;
CREATE POLICY "current_bus_locations_select" ON current_bus_locations
  FOR SELECT USING (true);

-- 3. COMPUTED_LOCATIONS TABLE - SELECT policy
DROP POLICY IF EXISTS "computed_locations_select" ON computed_locations;
CREATE POLICY "computed_locations_select" ON computed_locations
  FOR SELECT USING (true);

-- 4. TRIPS TABLE - SELECT policy
DROP POLICY IF EXISTS "trips_select" ON trips;
CREATE POLICY "trips_select" ON trips
  FOR SELECT USING (true);

-- 5. Create rate limiting function
CREATE OR REPLACE FUNCTION rate_limit_location_submission()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM current_bus_locations
    WHERE source_user_id = NEW.source_user_id
    AND source_role = NEW.source_role
    AND updated_at > NOW() - INTERVAL '2500 milliseconds'
  ) THEN
    RAISE EXCEPTION 'Rate limit exceeded: wait 2.5 seconds before next submission';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. Apply rate limiting trigger
DROP TRIGGER IF EXISTS rate_limit_trigger ON current_bus_locations;
CREATE TRIGGER rate_limit_trigger
BEFORE INSERT OR UPDATE ON current_bus_locations
FOR EACH ROW EXECUTE FUNCTION rate_limit_location_submission();

-- 7. Create validation function
CREATE OR REPLACE FUNCTION validate_location_submission()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.latitude < 8 OR NEW.latitude > 36 THEN
    RAISE EXCEPTION 'Invalid latitude: must be between 8 and 36';
  END IF;
  
  IF NEW.longitude < 68 OR NEW.longitude > 97 THEN
    RAISE EXCEPTION 'Invalid longitude: must be between 68 and 97';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 8. Apply validation trigger
DROP TRIGGER IF EXISTS validate_location_trigger ON current_bus_locations;
CREATE TRIGGER validate_location_trigger
BEFORE INSERT OR UPDATE ON current_bus_locations
FOR EACH ROW EXECUTE FUNCTION validate_location_submission();

-- Done!
SELECT 'All RLS policies and triggers created successfully' AS status;
