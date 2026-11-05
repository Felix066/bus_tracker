-- ============================================================================
-- MIGRATION 20261105_01: MULTI-INSTITUTION SCHEMA
-- Project: Where Is My Bus SaaS Transformation
-- Description: Creates institutions, institution_access_codes, platform_admins,
--              and platform_audit_logs tables, and adds institution_id column
--              to all tenant-owned tables.
-- ============================================================================

-- Enable pgcrypto / uuid-ossp if not already enabled
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. INSTITUTIONS TABLE
CREATE TABLE IF NOT EXISTS public.institutions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_name TEXT NOT NULL,
    institution_type TEXT NOT NULL DEFAULT 'college' CHECK (institution_type IN ('college', 'school', 'university', 'institute', 'other')),
    institution_code TEXT UNIQUE NOT NULL, -- Short unique slug/identifier, e.g. 'PCE-001'
    address TEXT,
    district TEXT,
    state TEXT,
    contact_person TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
    allow_admin_code_rotation BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookup by code & status
CREATE INDEX IF NOT EXISTS idx_institutions_code ON public.institutions (institution_code);
CREATE INDEX IF NOT EXISTS idx_institutions_status ON public.institutions (status);

-- 2. INSTITUTION ACCESS CODES TABLE
-- Never stores plaintext access codes. Stores HMAC-SHA-256 hash.
CREATE TABLE IF NOT EXISTS public.institution_access_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
    code_hash TEXT UNIQUE NOT NULL,
    hash_key_version TEXT NOT NULL DEFAULT 'v1',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    rotated_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_by TEXT DEFAULT 'system',
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Crucial: exactly ONE active code per institution
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_code_per_institution 
    ON public.institution_access_codes (institution_id) 
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_access_codes_hash_status 
    ON public.institution_access_codes (code_hash, status);

-- 3. PLATFORM ADMINS TABLE (Developer Super Admins)
-- Completely isolated from institution admins
CREATE TABLE IF NOT EXISTS public.platform_admins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'super_admin' CHECK (role = 'super_admin'),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. PLATFORM AUDIT LOGS TABLE
CREATE TABLE IF NOT EXISTS public.platform_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id TEXT NOT NULL,
    actor_type TEXT NOT NULL CHECK (actor_type IN ('super_admin', 'institution_admin', 'system')),
    action TEXT NOT NULL,
    institution_id UUID REFERENCES public.institutions(id) ON DELETE SET NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_audit_institution ON public.platform_audit_logs (institution_id);
CREATE INDEX IF NOT EXISTS idx_platform_audit_action ON public.platform_audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_platform_audit_created ON public.platform_audit_logs (created_at DESC);

-- 5. ADD institution_id FOREIGN KEY TO EXISTING OPERATIONAL TABLES
-- Add column safely if it doesn't already exist

DO $$
BEGIN
    -- admins table
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'admins') THEN
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'admins' AND column_name = 'institution_id') THEN
            ALTER TABLE public.admins ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE;
            CREATE INDEX idx_admins_institution ON public.admins(institution_id);
        END IF;
    END IF;

    -- drivers table
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'drivers') THEN
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'drivers' AND column_name = 'institution_id') THEN
            ALTER TABLE public.drivers ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE;
            CREATE INDEX idx_drivers_institution ON public.drivers(institution_id);
        END IF;
    END IF;

    -- buses table
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'buses') THEN
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'buses' AND column_name = 'institution_id') THEN
            ALTER TABLE public.buses ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE;
            CREATE INDEX idx_buses_institution ON public.buses(institution_id);
        END IF;
    END IF;

    -- trips table
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'trips') THEN
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'trips' AND column_name = 'institution_id') THEN
            ALTER TABLE public.trips ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE;
            CREATE INDEX idx_trips_institution ON public.trips(institution_id);
        END IF;
    END IF;

    -- current_bus_locations table
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'current_bus_locations') THEN
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'current_bus_locations' AND column_name = 'institution_id') THEN
            ALTER TABLE public.current_bus_locations ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE;
            CREATE INDEX idx_curr_bus_loc_institution ON public.current_bus_locations(institution_id);
        END IF;
    END IF;

    -- bus_locations table
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'bus_locations') THEN
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'bus_locations' AND column_name = 'institution_id') THEN
            ALTER TABLE public.bus_locations ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE;
            CREATE INDEX idx_bus_loc_institution ON public.bus_locations(institution_id);
        END IF;
    END IF;

    -- computed_locations table
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'computed_locations') THEN
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'computed_locations' AND column_name = 'institution_id') THEN
            ALTER TABLE public.computed_locations ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE;
            CREATE INDEX idx_computed_loc_institution ON public.computed_locations(institution_id);
        END IF;
    END IF;

    -- driver_sessions table
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'driver_sessions') THEN
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'driver_sessions' AND column_name = 'institution_id') THEN
            ALTER TABLE public.driver_sessions ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE;
            CREATE INDEX idx_driver_sessions_institution ON public.driver_sessions(institution_id);
        END IF;
    END IF;

    -- driver_messages table
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'driver_messages') THEN
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'driver_messages' AND column_name = 'institution_id') THEN
            ALTER TABLE public.driver_messages ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE;
            CREATE INDEX idx_driver_messages_institution ON public.driver_messages(institution_id);
        END IF;
    END IF;

    -- sos_alerts table
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sos_alerts') THEN
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'sos_alerts' AND column_name = 'institution_id') THEN
            ALTER TABLE public.sos_alerts ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE;
            CREATE INDEX idx_sos_alerts_institution ON public.sos_alerts(institution_id);
        END IF;
    END IF;

    -- stop_arrivals table
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stop_arrivals') THEN
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'stop_arrivals' AND column_name = 'institution_id') THEN
            ALTER TABLE public.stop_arrivals ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE;
            CREATE INDEX idx_stop_arrivals_institution ON public.stop_arrivals(institution_id);
        END IF;
    END IF;

    -- destinations table
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'destinations') THEN
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'destinations' AND column_name = 'institution_id') THEN
            ALTER TABLE public.destinations ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE;
            CREATE INDEX idx_destinations_institution ON public.destinations(institution_id);
        END IF;
    END IF;

    -- admin_logs table
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'admin_logs') THEN
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'admin_logs' AND column_name = 'institution_id') THEN
            ALTER TABLE public.admin_logs ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE;
            CREATE INDEX idx_admin_logs_institution ON public.admin_logs(institution_id);
        END IF;
    END IF;

    -- authorized_users table
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'authorized_users') THEN
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'authorized_users' AND column_name = 'institution_id') THEN
            ALTER TABLE public.authorized_users ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE;
            CREATE INDEX idx_auth_users_institution ON public.authorized_users(institution_id);
        END IF;
    END IF;
END $$;
