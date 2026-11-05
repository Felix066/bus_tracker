# MULTI-TENANT SAAS ARCHITECTURE SPECIFICATION
## Where Is My Bus — Centralized Fleet & Campus Transit Management Platform

---

## 1. Executive Architectural Overview

Where Is My Bus has been transformed from a single-institution deployment (originally tailored for Providence College of Engineering, `PCE-001`) into an enterprise-grade, multi-institution Transportation-as-a-Service (SaaS) platform. 

The architecture supports multiple independent educational institutions (colleges, universities, secondary schools, polytechnics) via:
- **A Single Centralized Codebase:** One Express.js backend and responsive vanilla JavaScript frontend.
- **A Unified Database with Logical Tenant Isolation:** Supabase PostgreSQL with schema-level `institution_id` foreign keys and Row Level Security (RLS).
- **Cryptographic Access-Code Gateways:** Institution Access Codes generated with 128 bits of cryptographic entropy and stored exclusively as keyed HMAC-SHA-256 hashes.
- **Strict Role-Based Access Control (RBAC):** Complete separation between Platform Super Admin (Developer), Institution Administrator, Driver, and Student/Parent/Teacher roles.

```mermaid
graph TD
    Client[Web Browser / PWA Client] -->|1. Enter Access Code| Resolve[/api/institutions/resolve-code]
    Resolve -->|HMAC-SHA-256 Hash Verification| CodeDB[(institution_access_codes Table)]
    Resolve -->|Return Public Branding| Client
    Client -->|2. Authenticate to Role Portal| AuthRouter{Authentication Router}
    AuthRouter -->|Developer Credentials| SuperAdminAPI[/api/platform/*]
    AuthRouter -->|Campus Admin Credentials| InstAdminAPI[/api/admin/* & /api/institution/*]
    AuthRouter -->|Driver Credentials| DriverAPI[/api/trip/* & /api/location/*]
    AuthRouter -->|Google GIS Token| StudentAPI[/api/public/* & /api/trip/:id/info]
    SuperAdminAPI --> PlatformDB[(Platform Admins & Audit Logs)]
    InstAdminAPI --> TenantTables[(Tenant-Scoped Tables: buses, trips, locations)]
    DriverAPI --> TenantTables
    StudentAPI --> TenantTables
```

---

## 2. Multi-Tenant Tenancy Model

The application employs **Logical Multi-Tenancy (Shared Database, Shared Schema)**. Every operational entity is strictly partitioned by `institution_id UUID`.

### 2.1 Supported User Roles

| Role | Scope | Authority & Permissions |
|---|---|---|
| **Platform Super Admin (Developer)** | Global | Full control over platform-wide configurations, tenant registration, initial code generation, manual code rotation, tenant deactivation, and global audit logging. |
| **Institution Administrator** | Single Tenant | Fleet management, bus creation, driver assignment, SOS dispatch, analytics, and tenant-level access code rotation (only when permitted by Developer). |
| **Bus Driver** | Single Tenant & Single Bus | Shift dispatch, starting/ending trips for their assigned vehicle, 3-second GPS updates, SOS alerts, and emergency messaging. |
| **Student / Parent / Faculty** | Single Tenant | View live active buses, track vehicle ETA via OpenRouteService/CartoDB, and inspect route arrival timelines. |

---

## 3. Database Architecture & Schema Extensions

### 3.1 New Core SaaS Tables

1. **`public.institutions`**
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - `institution_name TEXT NOT NULL`
   - `institution_type TEXT NOT NULL DEFAULT 'college'`
   - `institution_code TEXT UNIQUE NOT NULL` (e.g., `PCE-001`, `KCT-002`)
   - `address`, `district`, `state`
   - `contact_person`, `contact_email`, `contact_phone`
   - `status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived'))`
   - `allow_admin_code_rotation BOOLEAN NOT NULL DEFAULT FALSE`
   - `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

2. **`public.institution_access_codes`**
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - `institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE`
   - `code_hash TEXT UNIQUE NOT NULL` (HMAC-SHA-256 digest)
   - `hash_key_version TEXT NOT NULL DEFAULT 'v1'`
   - `status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired'))`
   - `created_at TIMESTAMPTZ`, `rotated_at TIMESTAMPTZ`, `revoked_at TIMESTAMPTZ`, `expires_at TIMESTAMPTZ`
   - `created_by TEXT` (actor username)
   - **Partial Unique Index:** `CREATE UNIQUE INDEX idx_one_active_code_per_institution ON public.institution_access_codes (institution_id) WHERE status = 'active';`

3. **`public.platform_admins`**
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - `username TEXT UNIQUE NOT NULL`
   - `email TEXT UNIQUE`
   - `password_hash TEXT NOT NULL` (bcrypt)
   - `role TEXT NOT NULL DEFAULT 'super_admin'`
   - `status TEXT NOT NULL DEFAULT 'active'`
   - `last_login_at TIMESTAMPTZ`, `created_at TIMESTAMPTZ`

4. **`public.platform_audit_logs`**
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - `actor_id TEXT NOT NULL`, `actor_type TEXT NOT NULL` (`'super_admin'`, `'institution_admin'`, `'system'`)
   - `action TEXT NOT NULL`
   - `institution_id UUID REFERENCES public.institutions(id)`
   - `metadata JSONB`, `ip_address TEXT`, `user_agent TEXT`, `created_at TIMESTAMPTZ`

### 3.2 Tenant Column Propagation
The foreign key column `institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE` is added to all tenant tables:
- `admins`, `drivers`, `buses`, `trips`, `current_bus_locations`, `bus_locations`, `computed_locations`, `driver_sessions`, `driver_messages`, `sos_alerts`, `stop_arrivals`, `destinations`, `admin_logs`, and `authorized_users`.

---

## 4. Cryptographic Access-Code Subsystem

### 4.1 Generation Algorithm
1. Extract alphanumeric slug prefix from institution identifier (e.g. `PCE-001` -> `PCE`).
2. Generate 16 bytes (128 bits) of high-entropy randomness using `crypto.randomBytes(16)`.
3. Format as 4-character blocks: `WIMB-<PREFIX>-<HEX4>-<HEX4>-<HEX4>-<HEX4>`.
4. Return plaintext strictly once upon generation/rotation.

### 4.2 Storage Algorithm
1. Normalize input: `.trim().toUpperCase()`.
2. Compute keyed HMAC-SHA-256 using server-side environment secret `INSTITUTION_CODE_HMAC_KEY`:
   $$\text{Hash} = \text{HMAC-SHA256}(\text{NormalizedCode}, \text{INSTITUTION\_CODE\_HMAC\_KEY})$$
3. Store solely the resulting 64-character hexadecimal digest.

---

## 5. Security Architecture & Boundary Defenses

1. **Zero Trust Browser Inputs:** Client-supplied `institution_id` values in request bodies or query strings are never trusted for authorization. The authenticated user's JWT token payload contains the cryptographically signed `institution_id`.
2. **Double-Layer Authorization:**
   - Layer 1: PostgreSQL Row Level Security (RLS) policies scoped by `auth.jwt() ->> 'institution_id'`.
   - Layer 2: Express.js query filters scoping queries by `req.user.institution_id`.
3. **Bfcache & Session Cache Protection:** `Cache-Control: no-store, no-cache, must-revalidate, private` headers prevent back-button re-entry into authenticated views after logout.
4. **Anti-Brute Force Protection:** Dedicated rate limiting using `express-rate-limit` on `/api/institutions/resolve-code` (20 attempts/min) and `/api/platform/login` (15 attempts/15 min).

---

## 6. Backward Compatibility Guarantee

Existing single-institution records for Providence College of Engineering continue working seamlessly:
- Seeded default institution UUID: `e1d4b680-1a2c-4f8a-9e3b-5a7c2d1e0f9b`.
- Operational endpoints default gracefully to Providence College when `institution_id` is omitted by older API clients.
- Existing database records with `institution_id IS NULL` are automatically backfilled to `e1d4b680-1a2c-4f8a-9e3b-5a7c2d1e0f9b`.
