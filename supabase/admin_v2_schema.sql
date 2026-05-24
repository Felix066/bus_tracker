-- Admin Panel V2.0 Schema Updates

-- 1. Add driver_name to buses table
ALTER TABLE buses ADD COLUMN IF NOT EXISTS driver_name TEXT DEFAULT NULL;

-- 2. Create driver_sessions table
CREATE TABLE IF NOT EXISTS driver_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bus_id TEXT NOT NULL UNIQUE,
  driver_name TEXT,
  is_online BOOLEAN DEFAULT FALSE,
  last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Enable RLS on driver_sessions
ALTER TABLE driver_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable read for all" ON driver_sessions FOR SELECT USING (true);
CREATE POLICY "Enable all for everyone" ON driver_sessions FOR ALL USING (true);
