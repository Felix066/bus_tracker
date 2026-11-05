-- ============================================================================
-- MIGRATION 20261105_02: MIGRATE EXISTING DATA TO MULTI-TENANCY
-- Project: Where Is My Bus SaaS Transformation
-- Description: Backfills existing single-institution data into Providence
--              College of Engineering (PCE-001), seeds initial access code,
--              and sets up the platform super admin account.
-- ============================================================================

DO $$
DECLARE
    v_default_inst_id UUID := 'e1d4b680-1a2c-4f8a-9e3b-5a7c2d1e0f9b';
    -- Production hardening: No exposed or static access code is stored.
    -- Generate an unpredictable cryptographic hash for initial setup.
    -- The Super Admin must rotate the code upon first login to generate and reveal a fresh 128-bit credential.
    v_initial_code_hash TEXT := encode(digest(gen_random_bytes(32), 'sha256'), 'hex');
BEGIN
    -- 1. SEED DEFAULT INSTITUTION: Providence College of Engineering
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
        true, -- Allow Providence College admin to rotate code if needed
        NOW(),
        NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
        institution_name = EXCLUDED.institution_name,
        institution_code = EXCLUDED.institution_code,
        status = 'active';

    -- 2. REVOKE ANY PREVIOUS STATIC/EXPOSED ACCESS CODES FOR PCE-001
    UPDATE public.institution_access_codes 
    SET status = 'revoked', revoked_at = NOW() 
    WHERE institution_id = v_default_inst_id AND status = 'active';

    -- 3. INSERT SECURE UNPREDICTABLE PLACEHOLDER (Pending rotation by Super Admin)
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

    -- NOTE: Platform Super Admin accounts are initialized strictly via the secure
    -- one-time server bootstrap mechanism using environment variables (SUPER_ADMIN_BOOTSTRAP_USER / PASS),
    -- ensuring no static or plaintext credentials exist in source-controlled migration scripts.

    -- 4. BACKFILL EXISTING OPERATIONAL TABLES TO PCE-001
    -- Admins
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'admins') THEN
        UPDATE public.admins SET institution_id = v_default_inst_id WHERE institution_id IS NULL;
    END IF;

    -- Drivers
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'drivers') THEN
        UPDATE public.drivers SET institution_id = v_default_inst_id WHERE institution_id IS NULL;
    END IF;

    -- Buses
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'buses') THEN
        UPDATE public.buses SET institution_id = v_default_inst_id WHERE institution_id IS NULL;
    END IF;

    -- Trips
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'trips') THEN
        UPDATE public.trips SET institution_id = v_default_inst_id WHERE institution_id IS NULL;
    END IF;

    -- Current Bus Locations
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'current_bus_locations') THEN
        UPDATE public.current_bus_locations SET institution_id = v_default_inst_id WHERE institution_id IS NULL;
    END IF;

    -- Bus Locations
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'bus_locations') THEN
        UPDATE public.bus_locations SET institution_id = v_default_inst_id WHERE institution_id IS NULL;
    END IF;

    -- Computed Locations
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'computed_locations') THEN
        UPDATE public.computed_locations SET institution_id = v_default_inst_id WHERE institution_id IS NULL;
    END IF;

    -- Driver Sessions
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'driver_sessions') THEN
        UPDATE public.driver_sessions SET institution_id = v_default_inst_id WHERE institution_id IS NULL;
    END IF;

    -- Driver Messages
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'driver_messages') THEN
        UPDATE public.driver_messages SET institution_id = v_default_inst_id WHERE institution_id IS NULL;
    END IF;

    -- SOS Alerts
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sos_alerts') THEN
        UPDATE public.sos_alerts SET institution_id = v_default_inst_id WHERE institution_id IS NULL;
    END IF;

    -- Stop Arrivals
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stop_arrivals') THEN
        UPDATE public.stop_arrivals SET institution_id = v_default_inst_id WHERE institution_id IS NULL;
    END IF;

    -- Destinations
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'destinations') THEN
        UPDATE public.destinations SET institution_id = v_default_inst_id WHERE institution_id IS NULL;
    END IF;

    -- Admin Logs
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'admin_logs') THEN
        UPDATE public.admin_logs SET institution_id = v_default_inst_id WHERE institution_id IS NULL;
    END IF;

    -- Authorized Users
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'authorized_users') THEN
        UPDATE public.authorized_users SET institution_id = v_default_inst_id WHERE institution_id IS NULL;
    END IF;

    -- 5. RECORD INITIAL AUDIT LOG
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

