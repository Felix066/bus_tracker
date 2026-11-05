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
    v_initial_code_hash TEXT := 'e9d6724c6151c3dea11489a1772c543292c5424081e5b2b9b0898c626fe27f7e'; -- HMAC-SHA-256 for WIMB-PCE-2026-X9T4-M7K2
    v_superadmin_pwd TEXT := '$2b$10$pUJyqb0RT1q9GDvoAUy4H.5RIDYDLOq6iEKFEzEeYNKBwLG1XpYHG'; -- SuperAdmin@2026!
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

    -- 2. SEED INITIAL ACCESS CODE FOR PCE-001
    -- Code: WIMB-PCE-2026-X9T4-M7K2 (Plaintext never stored!)
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
        'system_bootstrap',
        '{"note": "Initial seeded access code for Providence College"}'::jsonb
    )
    ON CONFLICT (code_hash) DO NOTHING;

    -- 3. SEED PLATFORM SUPER ADMIN (Platform Developer)
    INSERT INTO public.platform_admins (
        username,
        email,
        password_hash,
        role,
        status,
        created_at
    ) VALUES (
        'superadmin',
        'platform-admin@whereismybus.internal',
        v_superadmin_pwd,
        'super_admin',
        'active',
        NOW()
    )
    ON CONFLICT (username) DO NOTHING;

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
