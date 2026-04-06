-- Authenticated users can read everything
CREATE POLICY "Enable read for authenticated users" ON drivers FOR SELECT USING (true);
CREATE POLICY "Enable read for authenticated users" ON trips FOR SELECT USING (true);
CREATE POLICY "Enable read for authenticated users" ON bus_locations FOR SELECT USING (true);
CREATE POLICY "Enable read for authenticated users" ON computed_locations FOR SELECT USING (true);
CREATE POLICY "Enable read for authenticated users" ON stop_arrivals FOR SELECT USING (true);
CREATE POLICY "Enable read for authenticated users" ON profiles FOR SELECT USING (true);

-- Allow inserting locations for anyone (proximity logic handled in JS)
CREATE POLICY "Enable insert for all roles" ON bus_locations FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable insert for drivers" ON computed_locations FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable insert for drivers" ON stop_arrivals FOR INSERT WITH CHECK (true);

-- Profiles auto-creation
CREATE POLICY "Enable insert for individual users" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- TRIPS management for drivers
CREATE POLICY "Enable trip management for drivers" ON trips FOR ALL USING (true);
