-- supabase/eta_cache_migration.sql
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- Creates the bus_eta_cache table for the Shared ETA Architecture.

-- ============================================================================
-- bus_eta_cache
-- Stores the most recent computed ETA for each bus.
-- Written by the backend ETAPollerManager (service role).
-- Read by the backend to serve cached results and broadcast via Realtime.
-- Students NEVER access this table directly.
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
  provider          TEXT,         -- 'ors' | 'haversine_fallback'
  status            TEXT,         -- 'FRESH' | 'STALE' | 'UNAVAILABLE'
  calculated_at     TIMESTAMPTZ  DEFAULT now(),
  expires_at        TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ  DEFAULT now()
);

-- Enable RLS — only the backend service role can access this table
ALTER TABLE public.bus_eta_cache ENABLE ROW LEVEL SECURITY;

-- No public policies — service role bypasses RLS automatically

-- Index for quick lookup by bus_id (already primary key, so this is implicit)
-- Index for expiry-based queries if needed in future
CREATE INDEX IF NOT EXISTS idx_bus_eta_cache_expires ON public.bus_eta_cache (expires_at);

-- ============================================================================
-- PostgreSQL Advisory Lock functions
-- These are built-in — no table needed.
-- ETALock.js calls: SELECT pg_try_advisory_lock($1) and SELECT pg_advisory_unlock($1)
-- via Supabase RPC.
-- ============================================================================

-- Expose pg_try_advisory_lock as a Supabase RPC function
-- (Supabase wraps it so it can be called via supabase.rpc())
CREATE OR REPLACE FUNCTION pg_try_advisory_lock(lock_id BIGINT)
RETURNS BOOLEAN
LANGUAGE SQL
AS $$
  SELECT pg_try_advisory_lock(lock_id);
$$;

-- Expose pg_advisory_unlock as a Supabase RPC function
CREATE OR REPLACE FUNCTION pg_advisory_unlock(lock_id BIGINT)
RETURNS BOOLEAN
LANGUAGE SQL
AS $$
  SELECT pg_advisory_unlock(lock_id);
$$;
