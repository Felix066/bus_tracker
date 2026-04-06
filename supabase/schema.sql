-- 1. DRIVERS TABLE
CREATE TABLE drivers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  assigned_bus  text NOT NULL,
  created_at    timestamptz DEFAULT now()
);

-- 2. TRIPS TABLE
CREATE TABLE trips (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bus_id             text NOT NULL,
  driver_id          uuid REFERENCES drivers(id),
  trip_type          text CHECK (trip_type IN ('morning','evening')),
  status             text CHECK (status IN ('active','completed','cancelled')) DEFAULT 'active',
  current_stop_index integer DEFAULT 0,
  started_at         timestamptz DEFAULT now(),
  completed_at       timestamptz
);

-- 3. BUS LOCATIONS (Raw logs from everyone)
CREATE TABLE bus_locations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id        uuid REFERENCES trips(id),
  bus_id         text NOT NULL,
  source_role    text CHECK (source_role IN ('driver','faculty','student')),
  source_user_id text,
  latitude       numeric(10,7) NOT NULL,
  longitude      numeric(10,7) NOT NULL,
  is_accepted    boolean DEFAULT true,
  submitted_at   timestamptz DEFAULT now()
);

-- 4. COMPUTED LOCATIONS (The averaged source of truth)
CREATE TABLE computed_locations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id     uuid REFERENCES trips(id),
  bus_id      text NOT NULL,
  latitude    numeric(10,7) NOT NULL,
  longitude   numeric(10,7) NOT NULL,
  speed_kmh   numeric(5,2),
  computed_at timestamptz DEFAULT now()
);

-- 5. STOP ARRIVALS
CREATE TABLE stop_arrivals (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id    uuid REFERENCES trips(id),
  stop_name  text NOT NULL,
  stop_index integer NOT NULL,
  arrived_at timestamptz DEFAULT now()
);

-- 6. PROFILES
CREATE TABLE profiles (
  id         uuid PRIMARY KEY REFERENCES auth.users(id),
  email      text NOT NULL,
  role       text CHECK (role IN ('student','faculty')),
  created_at timestamptz DEFAULT now()
);

-- SEED DATA (Password hashes must be generated via Edge Function or bcrypt)
INSERT INTO drivers (username, password_hash, assigned_bus) VALUES
  ('driver1','REPLACE_WITH_HASH','Bus 1'),
  ('driver2','REPLACE_WITH_HASH','Bus 2'),
  ('driver3','REPLACE_WITH_HASH','Bus 3'),
  ('driver4','REPLACE_WITH_HASH','Bus 4'),
  ('driver5','REPLACE_WITH_HASH','Bus 5'),
  ('driver6','REPLACE_WITH_HASH','Bus 6');
