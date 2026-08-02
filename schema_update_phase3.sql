-- =========================================
-- Phase 3 Schema Updates: History & Chat
-- =========================================

-- 1. Create trip_history table
CREATE TABLE IF NOT EXISTS public.trip_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bus_id uuid REFERENCES public.buses(id) ON DELETE CASCADE,
    driver_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    start_time timestamp with time zone NOT NULL,
    end_time timestamp with time zone NOT NULL DEFAULT now(),
    route_name text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

-- Enable RLS for trip_history
ALTER TABLE public.trip_history ENABLE ROW LEVEL SECURITY;

-- Allow service role full access to trip_history
CREATE POLICY "Allow service role full access" ON public.trip_history 
    USING (true) WITH CHECK (true);

-- 2. Create driver_messages table
CREATE TABLE IF NOT EXISTS public.driver_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bus_id uuid REFERENCES public.buses(id) ON DELETE CASCADE,
    sender_role text NOT NULL CHECK (sender_role IN ('admin', 'driver')),
    message text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

-- Enable RLS for driver_messages
ALTER TABLE public.driver_messages ENABLE ROW LEVEL SECURITY;

-- Allow service role full access to driver_messages
CREATE POLICY "Allow service role full access" ON public.driver_messages 
    USING (true) WITH CHECK (true);

-- Allow public read access to driver_messages (optional, if using Realtime from frontend)
-- For this project, we'll allow public reads so the frontend can subscribe via Realtime easily.
CREATE POLICY "Allow public read access" ON public.driver_messages 
    FOR SELECT USING (true);

