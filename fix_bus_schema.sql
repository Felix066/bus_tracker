-- Run this script in the Supabase SQL Editor to fix the Admin Dashboard Save System Error
-- It ensures that the buses table has all the necessary columns that the frontend tries to save.

ALTER TABLE public.buses 
ADD COLUMN IF NOT EXISTS driver_name TEXT,
ADD COLUMN IF NOT EXISTS route_name TEXT,
ADD COLUMN IF NOT EXISTS number_plate TEXT,
ADD COLUMN IF NOT EXISTS driver_phone TEXT,
ADD COLUMN IF NOT EXISTS bus_photo_url TEXT,
ADD COLUMN IF NOT EXISTS driver_photo_url TEXT;

-- Verify the columns were added correctly
-- Select a few rows just to check
SELECT id, driver_name, route_name FROM public.buses LIMIT 5;
