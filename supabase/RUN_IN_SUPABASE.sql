-- ============================================================================
-- WHERE IS MY BUS — MASTER PRODUCTION SUPABASE MIGRATION
-- ============================================================================
-- Run this ENTIRE script in: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Safe to run multiple times (uses idempotent IF NOT EXISTS and ON CONFLICT guards).
-- ============================================================================

-- 0. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. MULTI-INSTITUTION SCHEMA
-- ============================================================================

-- 1.1 INSTITUTIONS TABLE
CREATE TABLE IF NOT EXISTS public.institutions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_name TEXT NOT NULL,
    institution_type TEXT NOT NULL DEFAULT 'college' CHECK (institution_type IN ('college', 'school', 'university', 'institute', 'other')),
    institution_code TEXT UNIQUE NOT NULL CONSTRAINT check_institution_code_format CHECK (institution_code ~ '^[A-Z0-9-]{2,20}$'),
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

CREATE INDEX IF NOT EXISTS idx_institutions_code ON public.institutions (institution_code);
CREATE INDEX IF NOT EXISTS idx_institutions_status ON public.institutions (status);

-- 1.2 INSTITUTION ACCESS CODES TABLE (HMAC-SHA-256 HASHED, NEVER PLAINTEXT)
CREATE TABLE IF NOT EXISTS public.institution_access_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
    code_hash TEXT UNIQUE NOT NULL CONSTRAINT check_code_hash_format CHECK (code_hash ~ '^[a-f0-9]{64}$'),
    hash_key_version TEXT NOT NULL DEFAULT 'v1',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    rotated_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_by TEXT DEFAULT 'system',
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_code_per_institution 
    ON public.institution_access_codes (institution_id) 
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_access_codes_hash_status 
    ON public.institution_access_codes (code_hash, status);

-- 1.3 PLATFORM ADMINS TABLE (DEVELOPER SUPER ADMINS)
CREATE TABLE IF NOT EXISTS public.platform_admins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'super_admin' CHECK (role = 'super_admin'),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    mfa_secret TEXT,
    mfa_backup_codes JSONB DEFAULT '[]'::jsonb,
    password_changed_at TIMESTAMPTZ DEFAULT NOW(),
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1.4 PLATFORM AUDIT LOGS TABLE
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

-- 1.5 ADD institution_id FOREIGN KEY TO EXISTING OPERATIONAL TABLES
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'admins') THEN
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'admins' AND column_name = 'institution_id') THEN
            ALTER TABLE public.admins ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE;
            CREATE INDEX idx_admins_institution ON public.admins(institution_id);
        END IF;
    END IF;

    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'drivers') THEN
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'drivers' AND column_name = 'institution_id') THEN
            ALTER TABLE public.drivers ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE;
            CREATE INDEX idx_drivers_institution ON public.drivers(institution_id);
        END IF;
    END IF;

    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'buses') THEN
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'buses' AND column_name = 'institution_id') THEN
            ALTER TABLE public.buses ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE;
            CREATE INDEX idx_buses_institution ON public.buses(institution_id);
        END IF;
    END IF;

    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'trips') THEN
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'trips' AND column_name = 'institution_id') THEN
            ALTER TABLE public.trips ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE;
            CREATE INDEX idx_trips_institution ON public.trips(institution_id);
        END IF;
    END IF;

    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'current_bus_locations') THEN
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'current_bus_locations' AND column_name = 'institution_id') THEN
            ALTER TABLE public.current_bus_locations ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE;
            CREATE INDEX idx_curr_bus_loc_institution ON public.current_bus_locations(institution_id);
        END IF;
    END IF;

    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'bus_locations') THEN
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'bus_locations' AND column_name = 'institution_id') THEN
            ALTER TABLE public.bus_locations ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE;
            CREATE INDEX idx_bus_loc_institution ON public.bus_locations(institution_id);
        END IF;
    END IF;

    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'computed_locations') THEN
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'computed_locations' AND column_name = 'institution_id') THEN
            ALTER TABLE public.computed_locations ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE;
            CREATE INDEX idx_computed_loc_institution ON public.computed_locations(institution_id);
        END IF;
    END IF;

    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'driver_sessions') THEN
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'driver_sessions' AND column_name = 'institution_id') THEN
            ALTER TABLE public.driver_sessions ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE;
            CREATE INDEX idx_driver_sessions_institution ON public.driver_sessions(institution_id);
        END IF;
    END IF;

    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'driver_messages') THEN
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'driver_messages' AND column_name = 'institution_id') THEN
            ALTER TABLE public.driver_messages ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE;
            CREATE INDEX idx_driver_messages_institution ON public.driver_messages(institution_id);
        END IF;
    END IF;

    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sos_alerts') THEN
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'sos_alerts' AND column_name = 'institution_id') THEN
            ALTER TABLE public.sos_alerts ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE;
            CREATE INDEX idx_sos_alerts_institution ON public.sos_alerts(institution_id);
        END IF;
    END IF;

    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stop_arrivals') THEN
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'stop_arrivals' AND column_name = 'institution_id') THEN
            ALTER TABLE public.stop_arrivals ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE;
            CREATE INDEX idx_stop_arrivals_institution ON public.stop_arrivals(institution_id);
        END IF;
    END IF;

    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'destinations') THEN
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'destinations' AND column_name = 'institution_id') THEN
            ALTER TABLE public.destinations ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE;
            CREATE INDEX idx_destinations_institution ON public.destinations(institution_id);
        END IF;
    END IF;

    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'admin_logs') THEN
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'admin_logs' AND column_name = 'institution_id') THEN
            ALTER TABLE public.admin_logs ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE;
            CREATE INDEX idx_admin_logs_institution ON public.admin_logs(institution_id);
        END IF;
    END IF;

    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'authorized_users') THEN
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'authorized_users' AND column_name = 'institution_id') THEN
            ALTER TABLE public.authorized_users ADD COLUMN institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE;
            CREATE INDEX idx_auth_users_institution ON public.authorized_users(institution_id);
        END IF;
    END IF;
END $$;

-- ============================================================================
-- 2. MIGRATE EXISTING DATA TO MULTI-TENANCY (SEEDS PROVIDENCE COLLEGE PCE-001)
-- ============================================================================
DO $$
DECLARE
    v_default_inst_id UUID := 'e1d4b680-1a2c-4f8a-9e3b-5a7c2d1e0f9b';
    -- Production hardening: Unpredictable dynamic hash for initial placeholder.
    -- The Super Admin rotates this upon deployment to obtain and reveal the initial access code.
    v_initial_code_hash TEXT := encode(digest(gen_random_bytes(32), 'sha256'), 'hex');
BEGIN
    -- 2.1 Seed Default Institution: Providence College of Engineering
    INSERT INTO public.institutions (
        id,
        institution_name,
        institution_type,
        institution_code,
        address,
        district,
        state,
        contact_person,
        contact_email,
        contact_phone,
        status,
        allow_admin_code_rotation,
        created_at,
        updated_at
    ) VALUES (
        v_default_inst_id,
        'Providence College of Engineering',
        'college',
        'PCE-001',
        'Angadical City, Chengannur',
        'Alappuzha',
        'Kerala',
        'Campus Transport Officer',
        'transport@providence.edu.in',
        '+91 479 245 1084',
        'active',
        true,
        NOW(),
        NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
        institution_name = EXCLUDED.institution_name,
        institution_code = EXCLUDED.institution_code,
        status = 'active';

    -- 2.2 Revoke any legacy/static codes
    UPDATE public.institution_access_codes 
    SET status = 'revoked', revoked_at = NOW() 
    WHERE institution_id = v_default_inst_id AND status = 'active';

    -- 2.3 Insert fresh unguessable placeholder
    INSERT INTO public.institution_access_codes (
        institution_id,
        code_hash,
        hash_key_version,
        status,
        created_at,
        created_by,
        metadata
    ) VALUES (
        v_default_inst_id,
        v_initial_code_hash,
        'v1',
        'active',
        NOW(),
        'system_migration_secure_bootstrap',
        '{"note": "Secure unguessable hash generated during migration. Must be rotated via Super Admin console to obtain initial plaintext."}'::jsonb
    )
    ON CONFLICT (code_hash) DO NOTHING;

    -- 2.4 Backfill existing operational tables to Providence College (PCE-001)
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'admins') THEN
        UPDATE public.admins SET institution_id = v_default_inst_id WHERE institution_id IS NULL;
    END IF;

    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'drivers') THEN
        UPDATE public.drivers SET institution_id = v_default_inst_id WHERE institution_id IS NULL;
    END IF;

    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'buses') THEN
        UPDATE public.buses SET institution_id = v_default_inst_id WHERE institution_id IS NULL;
    END IF;

    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'trips') THEN
        UPDATE public.trips SET institution_id = v_default_inst_id WHERE institution_id IS NULL;
    END IF;

    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'current_bus_locations') THEN
        UPDATE public.current_bus_locations SET institution_id = v_default_inst_id WHERE institution_id IS NULL;
    END IF;

    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'bus_locations') THEN
        UPDATE public.bus_locations SET institution_id = v_default_inst_id WHERE institution_id IS NULL;
    END IF;

    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'computed_locations') THEN
        UPDATE public.computed_locations SET institution_id = v_default_inst_id WHERE institution_id IS NULL;
    END IF;

    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'driver_sessions') THEN
        UPDATE public.driver_sessions SET institution_id = v_default_inst_id WHERE institution_id IS NULL;
    END IF;

    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'driver_messages') THEN
        UPDATE public.driver_messages SET institution_id = v_default_inst_id WHERE institution_id IS NULL;
    END IF;

    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sos_alerts') THEN
        UPDATE public.sos_alerts SET institution_id = v_default_inst_id WHERE institution_id IS NULL;
    END IF;

    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stop_arrivals') THEN
        UPDATE public.stop_arrivals SET institution_id = v_default_inst_id WHERE institution_id IS NULL;
    END IF;

    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'destinations') THEN
        UPDATE public.destinations SET institution_id = v_default_inst_id WHERE institution_id IS NULL;
    END IF;

    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'admin_logs') THEN
        UPDATE public.admin_logs SET institution_id = v_default_inst_id WHERE institution_id IS NULL;
    END IF;

    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'authorized_users') THEN
        UPDATE public.authorized_users SET institution_id = v_default_inst_id WHERE institution_id IS NULL;
    END IF;

    -- 2.5 Record audit log
    INSERT INTO public.platform_audit_logs (
        actor_id,
        actor_type,
        action,
        institution_id,
        metadata,
        created_at
    ) VALUES (
        'bootstrap',
        'system',
        'SYSTEM_MIGRATION_BOOTSTRAP',
        v_default_inst_id,
        '{"event": "Multi-tenant migration applied; default institution seeded"}'::jsonb,
        NOW()
    );
END $$;

-- ============================================================================
-- 3. MULTI-TENANT ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

CREATE OR REPLACE FUNCTION public.jwt_institution_id()
RETURNS UUID AS $$
    SELECT NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'institution_id', '')::UUID;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION public.jwt_is_super_admin()
RETURNS BOOLEAN AS $$
    SELECT COALESCE((current_setting('request.jwt.claims', true)::jsonb->>'role') = 'super_admin', false);
$$ LANGUAGE sql STABLE;

-- Institutions table RLS
ALTER TABLE public.institutions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS institutions_public_read ON public.institutions;
CREATE POLICY institutions_public_read ON public.institutions
    FOR SELECT
    USING (status = 'active' OR public.jwt_is_super_admin());

DROP POLICY IF EXISTS institutions_superadmin_write ON public.institutions;
CREATE POLICY institutions_superadmin_write ON public.institutions
    FOR ALL
    USING (public.jwt_is_super_admin());

-- Institution Access Codes table RLS (Never accessible to public)
ALTER TABLE public.institution_access_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS access_codes_superadmin_manage ON public.institution_access_codes;
CREATE POLICY access_codes_superadmin_manage ON public.institution_access_codes
    FOR ALL
    USING (public.jwt_is_super_admin());

-- Platform Admins table RLS
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_admins_superadmin_access ON public.platform_admins;
CREATE POLICY platform_admins_superadmin_access ON public.platform_admins
    FOR ALL
    USING (public.jwt_is_super_admin());

-- Platform Audit Logs table RLS
ALTER TABLE public.platform_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_audit_logs_read ON public.platform_audit_logs;
CREATE POLICY platform_audit_logs_read ON public.platform_audit_logs
    FOR SELECT
    USING (public.jwt_is_super_admin());

-- Multi-Tenant Buses table RLS
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'buses') THEN
        ALTER TABLE public.buses ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS buses_tenant_select ON public.buses;
        CREATE POLICY buses_tenant_select ON public.buses
            FOR SELECT
            USING (
                public.jwt_is_super_admin() OR 
                (institution_id IS NOT NULL AND institution_id = public.jwt_institution_id())
            );

        DROP POLICY IF EXISTS buses_tenant_manage ON public.buses;
        CREATE POLICY buses_tenant_manage ON public.buses
            FOR ALL
            USING (
                public.jwt_is_super_admin() OR 
                (institution_id IS NOT NULL AND institution_id = public.jwt_institution_id() AND (current_setting('request.jwt.claims', true)::jsonb->>'role') = 'admin')
            );
    END IF;
END $$;

-- Multi-Tenant Trips table RLS
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'trips') THEN
        ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS trips_tenant_select ON public.trips;
        CREATE POLICY trips_tenant_select ON public.trips
            FOR SELECT
            USING (
                public.jwt_is_super_admin() OR 
                (institution_id IS NOT NULL AND institution_id = public.jwt_institution_id())
            );

        DROP POLICY IF EXISTS trips_tenant_write ON public.trips;
        CREATE POLICY trips_tenant_write ON public.trips
            FOR ALL
            USING (
                public.jwt_is_super_admin() OR 
                (institution_id IS NOT NULL AND institution_id = public.jwt_institution_id())
            );
    END IF;
END $$;

-- Multi-Tenant Current Bus Locations table RLS
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'current_bus_locations') THEN
        ALTER TABLE public.current_bus_locations ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS curr_bus_loc_tenant_select ON public.current_bus_locations;
        CREATE POLICY curr_bus_loc_tenant_select ON public.current_bus_locations
            FOR SELECT
            USING (
                public.jwt_is_super_admin() OR 
                (institution_id IS NOT NULL AND institution_id = public.jwt_institution_id())
            );

        DROP POLICY IF EXISTS curr_bus_loc_tenant_write ON public.current_bus_locations;
        CREATE POLICY curr_bus_loc_tenant_write ON public.current_bus_locations
            FOR ALL
            USING (
                public.jwt_is_super_admin() OR 
                (institution_id IS NOT NULL AND institution_id = public.jwt_institution_id())
            );
    END IF;
END $$;

-- Multi-Tenant SOS Alerts table RLS
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sos_alerts') THEN
        ALTER TABLE public.sos_alerts ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS sos_alerts_tenant_access ON public.sos_alerts;
        CREATE POLICY sos_alerts_tenant_access ON public.sos_alerts
            FOR ALL
            USING (
                public.jwt_is_super_admin() OR 
                (institution_id IS NOT NULL AND institution_id = public.jwt_institution_id())
            );
    END IF;
END $$;

-- ============================================================================
-- 4. ETA CACHE TABLE & ADVISORY LOCK RPCS (ROUTING ENGINE OPTIMIZATION)
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
  provider          TEXT,
  status            TEXT,
  calculated_at     TIMESTAMPTZ DEFAULT now(),
  expires_at        TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.bus_eta_cache ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_bus_eta_cache_expires ON public.bus_eta_cache (expires_at);

CREATE OR REPLACE FUNCTION public.pg_try_advisory_lock(lock_id BIGINT)
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER SET search_path = public AS $$
  SELECT pg_try_advisory_lock(lock_id);
$$;

CREATE OR REPLACE FUNCTION public.pg_advisory_unlock(lock_id BIGINT)
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER SET search_path = public AS $$
  SELECT pg_advisory_unlock(lock_id);
$$;

-- Voice chat audio bucket setup
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-audio', 'chat-audio', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "chat_audio_insert" ON storage.objects;
CREATE POLICY "chat_audio_insert" ON storage.objects FOR INSERT TO authenticated, anon WITH CHECK (bucket_id = 'chat-audio');

DROP POLICY IF EXISTS "chat_audio_select" ON storage.objects;
CREATE POLICY "chat_audio_select" ON storage.objects FOR SELECT TO authenticated, anon USING (bucket_id = 'chat-audio');

DROP POLICY IF EXISTS "chat_audio_delete" ON storage.objects;
CREATE POLICY "chat_audio_delete" ON storage.objects FOR DELETE TO authenticated, anon USING (bucket_id = 'chat-audio');

-- Enable Realtime for driver messages safely (checks if already a member)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
          AND schemaname = 'public' 
          AND tablename = 'driver_messages'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_messages;
    END IF;
END $$;

-- ============================================================================
-- VERIFICATION CONFIRMATION
-- ============================================================================
SELECT 'Where Is My Bus — Complete Multi-Tenant Database Migration Applied Successfully' AS result;

