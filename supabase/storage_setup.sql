-- Run this script in the Supabase SQL Editor to set up the storage buckets for images

-- 1. Create the 'bus-images' and 'driver-images' buckets
INSERT INTO storage.buckets (id, name, public) 
VALUES 
  ('bus-images', 'bus-images', true),
  ('driver-images', 'driver-images', true)
ON CONFLICT (id) DO NOTHING;

-- 2. Allow public access to read images
CREATE POLICY "Public Read Access" ON storage.objects 
  FOR SELECT USING (bucket_id IN ('bus-images', 'driver-images'));

-- 3. Allow uploads to these buckets
CREATE POLICY "Public Upload Access" ON storage.objects 
  FOR INSERT WITH CHECK (bucket_id IN ('bus-images', 'driver-images'));

-- 4. Allow updates/overwrites if needed
CREATE POLICY "Public Update Access" ON storage.objects 
  FOR UPDATE USING (bucket_id IN ('bus-images', 'driver-images'));

-- 5. Allow deletes if needed
CREATE POLICY "Public Delete Access" ON storage.objects 
  FOR DELETE USING (bucket_id IN ('bus-images', 'driver-images'));
