# PRODUCTION DEPLOYMENT GUIDE
## Where Is My Bus Multi-Tenant SaaS Platform

---

## 1. Deployment Architecture

Where Is My Bus is designed to be hosted on **Render** (Node.js web service) backed by **Supabase PostgreSQL** and **Leaflet / OpenStreetMap / CartoDB** tile services.

```
[Users / Devices]
       │
       ▼ (HTTPS)
[Render Cloud Service]  ── (Static Assets) ──> HTML / CSS / JS / PWA Manifests
       │
       ▼ (Express API)
  ├── Rate Limiting (express-rate-limit)
  ├── Security Headers (Helmet + Cache-Control: no-store)
  ├── JWT Auth & Role-Based Middleware
  └── Cryptographic HMAC Access Code Engine
       │
       ▼ (Encrypted Connection)
[Supabase PostgreSQL]
  ├── Multi-Tenant Schema (institutions, institution_access_codes)
  ├── Row Level Security (RLS) Policies
  └── Operational Fleet Tables (buses, trips, locations)
```

---

## 2. Environment Variables Configuration (Render)

Navigate to **Render Dashboard → Where Is My Bus Web Service → Environment Variables** and configure the following variables:

| Variable Name | Required | Description & Format |
|---|---|---|
| `NODE_ENV` | Yes | Set to `production`. |
| `PORT` | Yes | Defaults to `3001` or Render's assigned `$PORT`. |
| `FRONTEND_URL` | Yes | `https://where-is-my-bus-639k.onrender.com` |
| `SUPABASE_URL` | Yes | `https://qlzqymdeguhzlxnfawiq.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase Service Role Secret Key (from Project Settings → API). |
| `JWT_SECRET` | Yes | Cryptographically random string $\ge 32$ characters. |
| `INSTITUTION_CODE_HMAC_KEY` | Yes | Cryptographically random secret key $\ge 32$ characters used to hash institution access codes. |
| `INSTITUTION_CODE_HMAC_KEY_VERSION` | Yes | Set to `v1`. |
| `SUPER_ADMIN_BOOTSTRAP_USER` | Yes | Developer Super Admin login username (e.g. `superadmin`). |
| `SUPER_ADMIN_BOOTSTRAP_PASS` | Yes | Complex developer password $\ge 16$ characters with mixed-case, numbers, and symbols. |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth 2.0 Web Client ID for student/faculty authentication. |
| `ORS_API_KEY` | Optional | OpenRouteService API key for road-network ETA calculation. |
| `ETA_POLL_INTERVAL_MS` | Optional | Default `45000` (45 seconds). |
| `VIEWER_TTL_MS` | Optional | Default `60000` (60 seconds). |

> [!CAUTION]
> Never commit `.env` or production secrets to Git. Always use `.env.example` as a template.

---

## 3. Order of Operations for Deployment

Follow this exact sequence to ensure zero downtime and maintain continuous backward compatibility:

### Step 1: Deploy Database Migrations to Supabase
1. Open the [Supabase Dashboard SQL Editor](https://supabase.com/dashboard/project/qlzqymdeguhzlxnfawiq).
2. Execute `supabase/migrations/20261105_01_multi_institution_schema.sql` (Creates SaaS tables & columns).
3. Execute `supabase/migrations/20261105_02_migrate_existing_data.sql` (Seeds Providence College, hashes initial access code, backfills legacy data).
4. Execute `supabase/migrations/20261105_03_rls_policies.sql` (Enables Row Level Security).

### Step 2: Configure Render Environment Variables
Add `INSTITUTION_CODE_HMAC_KEY`, `SUPER_ADMIN_BOOTSTRAP_USER`, and `SUPER_ADMIN_BOOTSTRAP_PASS` in the Render dashboard.

### Step 3: Deploy Code via Git Push
Push the updated code to GitHub:
```bash
git add .
git commit -m "Transform Where Is My Bus into multi-institution SaaS with cryptographic access codes and Super Admin console"
git push origin main
```
Render automatically triggers the build and deploy pipeline.

### Step 4: Post-Deployment Smoke Verification
1. Open the production URL: [https://where-is-my-bus-639k.onrender.com/](https://where-is-my-bus-639k.onrender.com/)
2. Verify the Institution Access Code entry form appears.
3. Enter the Providence College access code: `WIMB-PCE-2026-X9T4-M7K2` (or `WIMB-PCE-001`).
4. Verify the landing screen transitions to **"Welcome to Providence College of Engineering"** with all role cards active.
5. Click **"Platform Super Admin Portal"** in the footer (`/super-admin-login.html`).
6. Sign in with the configured Super Admin credentials.
7. Verify dashboard statistics and institution list load correctly.
8. Register a test institution (e.g., `TEST-001`), copy its generated access code, and verify resolving it on the landing page.

---

## 4. Rollback Plan

If an unexpected production issue arises:
1. **Application Rollback:** In Render Dashboard, click **Deploys** and select **Rollback** to revert to the previous release commit.
2. **Database Rollback:** If necessary, execute the rollback script documented in `DATABASE_MIGRATION_GUIDE.md` in the Supabase SQL editor.

