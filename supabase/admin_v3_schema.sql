-- Admin Panel V3.0 Schema Updates

-- 1. Upgrade the buses table with new fields
ALTER TABLE buses 
ADD COLUMN IF NOT EXISTS route_name TEXT,
ADD COLUMN IF NOT EXISTS number_plate TEXT,
ADD COLUMN IF NOT EXISTS driver_phone TEXT,
ADD COLUMN IF NOT EXISTS bus_photo_url TEXT,
ADD COLUMN IF NOT EXISTS driver_photo_url TEXT;

-- 2. Create admin logs table
CREATE TABLE IF NOT EXISTS admin_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_username TEXT NOT NULL,
  action_text TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Create SOS alerts table
CREATE TABLE IF NOT EXISTS sos_alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bus_id TEXT NOT NULL,
  driver_name TEXT,
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'resolved')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Enable RLS and Policies
ALTER TABLE admin_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sos_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read for all" ON admin_logs FOR SELECT USING (true);
CREATE POLICY "Enable insert for all" ON admin_logs FOR INSERT WITH CHECK (true);

CREATE POLICY "Enable read for all" ON sos_alerts FOR SELECT USING (true);
CREATE POLICY "Enable insert for all" ON sos_alerts FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update for all" ON sos_alerts FOR UPDATE USING (true);
