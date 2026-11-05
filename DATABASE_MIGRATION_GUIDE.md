# DATABASE MIGRATION & RLS ARCHITECTURE GUIDE
## Where Is My Bus Multi-Tenant SaaS Transformation

---

## 1. Overview of SQL Migration Files

The database schema has been modularized into three version-controlled, idempotent SQL migration files located in `supabase/migrations/`:

| Migration File | Purpose | Key Objects Created / Modified |
|---|---|---|
| [`20261105_01_multi_institution_schema.sql`](supabase/migrations/20261105_01_multi_institution_schema.sql) | Schema & Table Definition | `institutions`, `institution_access_codes`, `platform_admins`, `platform_audit_logs`, and adds `institution_id` FK columns to all tenant tables. |
| [`20261105_02_migrate_existing_data.sql`](supabase/migrations/20261105_02_migrate_existing_data.sql) | Data Seeding & Backfill | Seeds Providence College of Engineering (`PCE-001`), seeds initial access code hash, seeds developer `superadmin` account, and backfills existing rows. |
| [`20261105_03_rls_policies.sql`](supabase/migrations/20261105_03_rls_policies.sql) | Multi-Tenant RLS Security | Helper functions `jwt_institution_id()`, `jwt_is_super_admin()`, and tenant-isolated Row Level Security policies. |

---

## 2. Step-by-Step Execution in Supabase

### Prerequisites
- Access to the Supabase Dashboard: [https://supabase.com/dashboard/project/qlzqymdeguhzlxnfawiq](https://supabase.com/dashboard/project/qlzqymdeguhzlxnfawiq)
- Navigate to **SQL Editor** from the left navigation menu.

### Step 1: Apply Migration 01 (Multi-Institution Schema)
1. Open [`supabase/migrations/20261105_01_multi_institution_schema.sql`](supabase/migrations/20261105_01_multi_institution_schema.sql).
2. Copy the entire file content into the Supabase SQL Editor.
3. Click **Run**.
4. **Verification Output:** `Success. No rows returned.`
5. Verify in **Table Editor** that tables `institutions`, `institution_access_codes`, `platform_admins`, and `platform_audit_logs` are visible.

### Step 2: Apply Migration 02 (Data Backfill & Seeding)
1. Open [`supabase/migrations/20261105_02_migrate_existing_data.sql`](supabase/migrations/20261105_02_migrate_existing_data.sql).
2. Paste the SQL into the editor.
3. Click **Run**.
4. **Verification Output:** `Success. No rows returned.`
5. Execute the following verification query to ensure legacy data has been backfilled:
   ```sql
   SELECT 
       (SELECT COUNT(*) FROM public.institutions) as total_institutions,
       (SELECT COUNT(*) FROM public.institution_access_codes) as total_access_codes,
       (SELECT COUNT(*) FROM public.platform_admins) as total_super_admins,
       (SELECT COUNT(*) FROM public.buses WHERE institution_id IS NOT NULL) as backfilled_buses;
   ```
   **Expected Result:**
   - `total_institutions` $\ge 1$ (`Providence College of Engineering`)
   - `total_access_codes` $\ge 1$ (`WIMB-PCE-2026-X9T4-M7K2` active hash)
   - `total_super_admins` $\ge 1$ (`superadmin`)
   - `backfilled_buses` equals total buses in fleet.

### Step 3: Apply Migration 03 (Row Level Security Policies)
1. Open [`supabase/migrations/20261105_03_rls_policies.sql`](supabase/migrations/20261105_03_rls_policies.sql).
2. Paste into the SQL editor and click **Run**.
3. **Verification Output:** RLS is active across tables with tenant-aware constraints.

---

## 3. Detailed Schema Specification

### 3.1 `institutions` Table
```sql
CREATE TABLE public.institutions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_name TEXT NOT NULL,
    institution_type TEXT NOT NULL DEFAULT 'college' CHECK (institution_type IN ('college', 'school', 'university', 'institute', 'other')),
    institution_code TEXT UNIQUE NOT NULL,
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
```

### 3.2 `institution_access_codes` Table
```sql
CREATE TABLE public.institution_access_codes (
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

-- Crucial: exactly ONE active access code per institution
CREATE UNIQUE INDEX idx_one_active_code_per_institution 
    ON public.institution_access_codes (institution_id) 
    WHERE status = 'active';
```

---

## 4. Rollback & Disaster Recovery Procedures

If a migration needs to be rolled back during maintenance:

```sql
-- ROLLBACK SCRIPT (Execute in emergency only)
BEGIN;

-- Drop RLS policies
DROP POLICY IF EXISTS institutions_public_read ON public.institutions;
DROP POLICY IF EXISTS institutions_superadmin_write ON public.institutions;
DROP POLICY IF EXISTS access_codes_superadmin_manage ON public.institution_access_codes;
DROP POLICY IF EXISTS platform_admins_superadmin_access ON public.platform_admins;
DROP POLICY IF EXISTS platform_audit_logs_read ON public.platform_audit_logs;

-- Drop foreign key columns from existing tables
ALTER TABLE public.admins DROP COLUMN IF EXISTS institution_id;
ALTER TABLE public.drivers DROP COLUMN IF EXISTS institution_id;
ALTER TABLE public.buses DROP COLUMN IF EXISTS institution_id;
ALTER TABLE public.trips DROP COLUMN IF EXISTS institution_id;
ALTER TABLE public.current_bus_locations DROP COLUMN IF EXISTS institution_id;
ALTER TABLE public.bus_locations DROP COLUMN IF EXISTS institution_id;
ALTER TABLE public.computed_locations DROP COLUMN IF EXISTS institution_id;
ALTER TABLE public.driver_sessions DROP COLUMN IF EXISTS institution_id;
ALTER TABLE public.driver_messages DROP COLUMN IF EXISTS institution_id;
ALTER TABLE public.sos_alerts DROP COLUMN IF EXISTS institution_id;
ALTER TABLE public.stop_arrivals DROP COLUMN IF EXISTS institution_id;
ALTER TABLE public.destinations DROP COLUMN IF EXISTS institution_id;
ALTER TABLE public.admin_logs DROP COLUMN IF EXISTS institution_id;
ALTER TABLE public.authorized_users DROP COLUMN IF EXISTS institution_id;

-- Drop core SaaS tables
DROP TABLE IF EXISTS public.platform_audit_logs;
DROP TABLE IF EXISTS public.platform_admins;
DROP TABLE IF EXISTS public.institution_access_codes;
DROP TABLE IF EXISTS public.institutions;

COMMIT;
```

