-- supabase/create_storage.sql
-- Run this in your Supabase SQL Editor to set up the chat-audio storage bucket
-- and the driver_messages table for the chat system.

-- ============================================================================
-- 1. CREATE CHAT AUDIO STORAGE BUCKET
-- ============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-audio', 'chat-audio', true)
ON CONFLICT (id) DO NOTHING;

-- Allow anyone (authenticated or anonymous) to upload audio files to the bucket
DROP POLICY IF EXISTS "Allow audio uploads" ON storage.objects;
CREATE POLICY "Allow audio uploads" ON storage.objects
  FOR INSERT TO authenticated, anon
  WITH CHECK (bucket_id = 'chat-audio');

-- Allow anyone to read/view audio files
DROP POLICY IF EXISTS "Allow audio reads" ON storage.objects;
CREATE POLICY "Allow audio reads" ON storage.objects
  FOR SELECT TO authenticated, anon
  USING (bucket_id = 'chat-audio');

-- ============================================================================
-- 2. CREATE DRIVER MESSAGES TABLE (for chat system)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.driver_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bus_id TEXT NOT NULL,
  message TEXT NOT NULL,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('admin', 'driver')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.driver_messages ENABLE ROW LEVEL SECURITY;

-- Backend (service_role) handles all mutations via Node.js
-- Only allow SELECT for anyone (messages are bus-specific and not private)
DROP POLICY IF EXISTS "Public can read messages" ON public.driver_messages;
CREATE POLICY "Public can read messages" ON public.driver_messages
  FOR SELECT USING (true);

-- Index for fast bus_id lookups
CREATE INDEX IF NOT EXISTS idx_driver_messages_bus_id ON public.driver_messages(bus_id);
CREATE INDEX IF NOT EXISTS idx_driver_messages_created_at ON public.driver_messages(created_at DESC);
