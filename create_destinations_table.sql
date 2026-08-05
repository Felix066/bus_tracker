-- ============================================================================
-- Run this in your Supabase SQL Editor
-- Creates the destinations table for Admin-controlled ETA destination
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.destinations (
    id integer PRIMARY KEY DEFAULT 1,
    name text NOT NULL DEFAULT 'Providence College of Engineering',
    latitude double precision NOT NULL DEFAULT 9.2990,
    longitude double precision NOT NULL DEFAULT 76.6154,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    updated_by text DEFAULT 'admin',
    CONSTRAINT single_destination CHECK (id = 1)
);

-- Insert default row (only 1 row ever exists — admin overwrites it)
INSERT INTO public.destinations (id, name, latitude, longitude)
VALUES (1, 'Providence College of Engineering', 9.2990, 76.6154)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude;

-- Enable RLS
ALTER TABLE public.destinations ENABLE ROW LEVEL SECURITY;

-- Allow everyone to READ (students need it)
DROP POLICY IF EXISTS "Allow public read" ON public.destinations;
CREATE POLICY "Allow public read" ON public.destinations
    FOR SELECT USING (true);

-- Allow service role full access (backend uses service role key, bypasses RLS)
DROP POLICY IF EXISTS "Allow service role full access" ON public.destinations;
CREATE POLICY "Allow service role full access" ON public.destinations
    USING (true) WITH CHECK (true);

-- Verify
SELECT id, name, latitude, longitude FROM public.destinations;
