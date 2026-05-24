-- 1. DROP EXISTING SCHEMA TO START CLEAN
DROP TABLE IF EXISTS stop_arrivals CASCADE;
DROP TABLE IF EXISTS computed_locations CASCADE;
DROP TABLE IF EXISTS bus_locations CASCADE;
DROP TABLE IF EXISTS trips CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;
DROP TABLE IF EXISTS drivers CASCADE;
DROP FUNCTION IF EXISTS handle_new_user() CASCADE;

-- 2. CREATE TABLES IN DEPENDENCY ORDER
CREATE TABLE drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  assigned_bus text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bus_id text NOT NULL,
  driver_id uuid REFERENCES drivers(id),
  trip_type text CHECK (trip_type IN ('morning','evening')),
  status text CHECK (status IN ('active','completed','cancelled')) DEFAULT 'active',
  current_stop_index integer DEFAULT 0,
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE bus_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid REFERENCES trips(id),
  bus_id text NOT NULL,
  source_role text CHECK (source_role IN ('driver','faculty','student')),
  source_user_id text,
  latitude numeric(10,7) NOT NULL,
  longitude numeric(10,7) NOT NULL,
  is_accepted boolean DEFAULT true,
  submitted_at timestamptz DEFAULT now()
);

CREATE TABLE computed_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid REFERENCES trips(id),
  bus_id text NOT NULL,
  latitude numeric(10,7) NOT NULL,
  longitude numeric(10,7) NOT NULL,
  speed_kmh numeric(5,2),
  computed_at timestamptz DEFAULT now()
);

CREATE TABLE stop_arrivals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid REFERENCES trips(id),
  stop_name text NOT NULL,
  stop_index integer NOT NULL,
  arrived_at timestamptz DEFAULT now()
);

CREATE TABLE profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text CHECK (role IN ('student','faculty')),
  created_at timestamptz DEFAULT now()
);

-- 3. ENABLE RLS
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE bus_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE computed_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE stop_arrivals ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- 4. UNIQUE RLS POLICIES (No policies for drivers so it is strictly accessible via Service Role only)
CREATE POLICY "profiles_select_policy" ON profiles FOR SELECT USING (true);
CREATE POLICY "trips_select_policy" ON trips FOR SELECT USING (true);
CREATE POLICY "trips_all_drivers_policy" ON trips FOR ALL USING (true);
CREATE POLICY "bus_locations_select_policy" ON bus_locations FOR SELECT USING (true);
CREATE POLICY "bus_locations_insert_policy" ON bus_locations FOR INSERT WITH CHECK (true);
CREATE POLICY "computed_locations_select_policy" ON computed_locations FOR SELECT USING (true);
CREATE POLICY "computed_locations_insert_policy" ON computed_locations FOR INSERT WITH CHECK (true);
CREATE POLICY "stop_arrivals_select_policy" ON stop_arrivals FOR SELECT USING (true);
CREATE POLICY "stop_arrivals_insert_policy" ON stop_arrivals FOR INSERT WITH CHECK (true);

-- 5. AUTO-PROFILE TRIGGER
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
DECLARE
  extracted_domain text;
  assigned_role text;
BEGIN
  extracted_domain := split_part(new.email, '@', 2);
  
  IF extracted_domain = 'student.providence.edu.in' THEN
    assigned_role := 'student';
  ELSIF extracted_domain = 'providence.edu.in' THEN
    assigned_role := 'faculty';
  ELSE
    assigned_role := 'student'; -- default fallback
  END IF;

  INSERT INTO public.profiles (id, email, role)
  VALUES (new.id, new.email, assigned_role);
  
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE handle_new_user();

-- 6. SEED DATA SECURELY WITH HASHED PASSWORDS
INSERT INTO drivers (username, password_hash, assigned_bus) VALUES
  ('driver1', crypt('password123', gen_salt('bf')), 'Bus 1'),
  ('driver2', crypt('password123', gen_salt('bf')), 'Bus 2'),
  ('driver3', crypt('password123', gen_salt('bf')), 'Bus 3'),
  ('driver4', crypt('password123', gen_salt('bf')), 'Bus 4'),
  ('driver5', crypt('password123', gen_salt('bf')), 'Bus 5'),
  ('driver6', crypt('password123', gen_salt('bf')), 'Bus 6');

-- 7. SECURE DRIVER VERIFICATION RPC
CREATE OR REPLACE FUNCTION verify_driver(input_username text, input_password text)
RETURNS jsonb AS $$
DECLARE
  v_driver RECORD;
BEGIN
  -- Find the driver by username
  SELECT id, username, assigned_bus, password_hash INTO v_driver
  FROM drivers
  WHERE username = input_username;

  -- If driver not found or password doesn't match the hash
  IF NOT FOUND OR v_driver.password_hash != crypt(input_password, v_driver.password_hash) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid username or password'
    );
  END IF;

  -- If password matches
  RETURN jsonb_build_object(
    'success', true,
    'driver', jsonb_build_object(
      'driverId', v_driver.id,
      'username', v_driver.username,
      'assignedBus', v_driver.assigned_bus
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
