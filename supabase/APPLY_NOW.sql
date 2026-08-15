-- ============================================================================
-- BusTrack — PENDING SUPABASE SQL
-- Run everything below in Supabase Dashboard → SQL Editor → New Query
-- Safe to run multiple times (uses IF NOT EXISTS / DROP IF EXISTS guards)
-- ============================================================================


-- ============================================================================
-- SECTION 1: ETA CACHE TABLE  (new — never applied)
-- Required by ETAPollerManager / ETACache.js
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.bus_eta_cache (
  bus_id            TEXT PRIMARY KEY,
  eta_seconds       INTEGER,
  eta_minutes       INTEGER,
  distance_meters   REAL,
  origin_lat        DOUBLE PRECISION,
  origin_lon        DOUBLE PRECISION,
  destination_lat   DOUBLE PRECISION,
  destination_lon   DOUBLE PRECISION,
  provider          TEXT,          -- 'ors' | 'haversine_fallback'
  status            TEXT,          -- 'FRESH' | 'STALE' | 'UNAVAILABLE'
  calculated_at     TIMESTAMPTZ   DEFAULT now(),
  expires_at        TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ   DEFAULT now()
);

-- RLS: service role bypasses automatically; no public access
ALTER TABLE public.bus_eta_cache ENABLE ROW LEVEL SECURITY;

-- Index for expiry-based housekeeping
CREATE INDEX IF NOT EXISTS idx_bus_eta_cache_expires
  ON public.bus_eta_cache (expires_at);


-- ============================================================================
-- SECTION 2: POSTGRESQL ADVISORY LOCK RPCs  (new — never applied)
-- Required by ETALock.js to prevent concurrent ORS API stampedes
-- ============================================================================

CREATE OR REPLACE FUNCTION public.pg_try_advisory_lock(lock_id BIGINT)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pg_try_advisory_lock(lock_id);
$$;

CREATE OR REPLACE FUNCTION public.pg_advisory_unlock(lock_id BIGINT)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pg_advisory_unlock(lock_id);
$$;


-- ============================================================================
-- SECTION 3: CHAT-AUDIO STORAGE BUCKET
-- Run if bucket doesn't exist yet (setup_bucket.js may have already done this)
-- ============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-audio', 'chat-audio', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Any user (driver uses anon Supabase key) can upload voice files
DROP POLICY IF EXISTS "chat_audio_insert" ON storage.objects;
CREATE POLICY "chat_audio_insert" ON storage.objects
  FOR INSERT TO authenticated, anon
  WITH CHECK (bucket_id = 'chat-audio');

-- Anyone can read / stream voice files
DROP POLICY IF EXISTS "chat_audio_select" ON storage.objects;
CREATE POLICY "chat_audio_select" ON storage.objects
  FOR SELECT TO authenticated, anon
  USING (bucket_id = 'chat-audio');

-- Allow deletion of old voice files (for housekeeping)
DROP POLICY IF EXISTS "chat_audio_delete" ON storage.objects;
CREATE POLICY "chat_audio_delete" ON storage.objects
  FOR DELETE TO authenticated, anon
  USING (bucket_id = 'chat-audio');


-- ============================================================================
-- SECTION 4: REALTIME PUBLICATION
-- driver_messages must be in the publication for INSERT + DELETE events to fire
-- ============================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_messages;


-- ============================================================================
-- DONE
-- ============================================================================
SELECT 'BusTrack pending SQL applied successfully' AS result;
