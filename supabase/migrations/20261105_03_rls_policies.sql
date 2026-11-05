-- ============================================================================
-- MIGRATION 20261105_03: MULTI-TENANT ROW LEVEL SECURITY (RLS) POLICIES
-- Project: Where Is My Bus SaaS Transformation
-- Description: Enables RLS on multi-tenant tables and establishes
--              institution-scoped access policies.
-- ============================================================================

-- Helper function to extract institution_id from JWT claims
CREATE OR REPLACE FUNCTION public.jwt_institution_id()
RETURNS UUID AS $$
    SELECT NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'institution_id', '')::UUID;
$$ LANGUAGE sql STABLE;

-- Helper function to check if the caller is super_admin
CREATE OR REPLACE FUNCTION public.jwt_is_super_admin()
RETURNS BOOLEAN AS $$
    SELECT COALESCE((current_setting('request.jwt.claims', true)::jsonb->>'role') = 'super_admin', false);
$$ LANGUAGE sql STABLE;

-- 1. INSTITUTIONS TABLE RLS
ALTER TABLE public.institutions ENABLE ROW LEVEL SECURITY;

-- Anyone can view active institutions (e.g. for branding resolution)
CREATE POLICY institutions_public_read ON public.institutions
    FOR SELECT
    USING (status = 'active' OR public.jwt_is_super_admin());

-- Only super admin / service role can insert, update, delete institutions
CREATE POLICY institutions_superadmin_write ON public.institutions
    FOR ALL
    USING (public.jwt_is_super_admin());

-- 2. INSTITUTION ACCESS CODES TABLE RLS
ALTER TABLE public.institution_access_codes ENABLE ROW LEVEL SECURITY;

-- Access code hashes are NEVER accessible publicly or to standard clients.
-- Only accessible via backend service-role or super_admin.
CREATE POLICY access_codes_superadmin_manage ON public.institution_access_codes
    FOR ALL
    USING (public.jwt_is_super_admin());

-- 3. PLATFORM ADMINS TABLE RLS
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

CREATE POLICY platform_admins_superadmin_access ON public.platform_admins
    FOR ALL
    USING (public.jwt_is_super_admin());

-- 4. PLATFORM AUDIT LOGS TABLE RLS
ALTER TABLE public.platform_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY platform_audit_logs_read ON public.platform_audit_logs
    FOR SELECT
    USING (public.jwt_is_super_admin());

-- 5. MULTI-TENANT BUSES TABLE RLS
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'buses') THEN
        ALTER TABLE public.buses ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS buses_tenant_select ON public.buses;
        CREATE POLICY buses_tenant_select ON public.buses
            FOR SELECT
            USING (
                public.jwt_is_super_admin() OR 
                institution_id IS NULL OR 
                institution_id = public.jwt_institution_id()
            );

        DROP POLICY IF EXISTS buses_tenant_manage ON public.buses;
        CREATE POLICY buses_tenant_manage ON public.buses
            FOR ALL
            USING (
                public.jwt_is_super_admin() OR 
                (institution_id = public.jwt_institution_id() AND (current_setting('request.jwt.claims', true)::jsonb->>'role') = 'admin')
            );
    END IF;
END $$;

-- 6. MULTI-TENANT TRIPS TABLE RLS
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'trips') THEN
        ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS trips_tenant_select ON public.trips;
        CREATE POLICY trips_tenant_select ON public.trips
            FOR SELECT
            USING (
                public.jwt_is_super_admin() OR 
                institution_id IS NULL OR 
                institution_id = public.jwt_institution_id()
            );

        DROP POLICY IF EXISTS trips_tenant_write ON public.trips;
        CREATE POLICY trips_tenant_write ON public.trips
            FOR ALL
            USING (
                public.jwt_is_super_admin() OR 
                institution_id = public.jwt_institution_id()
            );
    END IF;
END $$;

-- 7. MULTI-TENANT CURRENT_BUS_LOCATIONS TABLE RLS
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'current_bus_locations') THEN
        ALTER TABLE public.current_bus_locations ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS curr_bus_loc_tenant_select ON public.current_bus_locations;
        CREATE POLICY curr_bus_loc_tenant_select ON public.current_bus_locations
            FOR SELECT
            USING (
                public.jwt_is_super_admin() OR 
                institution_id IS NULL OR 
                institution_id = public.jwt_institution_id()
            );

        DROP POLICY IF EXISTS curr_bus_loc_tenant_write ON public.current_bus_locations;
        CREATE POLICY curr_bus_loc_tenant_write ON public.current_bus_locations
            FOR ALL
            USING (
                public.jwt_is_super_admin() OR 
                institution_id = public.jwt_institution_id()
            );
    END IF;
END $$;

-- 8. MULTI-TENANT SOS_ALERTS TABLE RLS
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sos_alerts') THEN
        ALTER TABLE public.sos_alerts ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS sos_alerts_tenant_access ON public.sos_alerts
            FOR ALL
            USING (
                public.jwt_is_super_admin() OR 
                institution_id = public.jwt_institution_id()
            );
    END IF;
END $$;
