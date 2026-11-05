# PLATFORM SUPER ADMIN & DEVELOPER OPERATING GUIDE
## Where Is My Bus SaaS Platform

---

## 1. Introduction

The **Developer Super Admin Dashboard** (`super-admin.html`) is an administrative console reserved exclusively for the platform developer and central operations team.

It provides centralized governance over:
- Multi-institution educational registrations.
- High-entropy Institution Access Code generation and rotation.
- Tenant status management (Active, Suspended, Archived).
- Platform-wide security audit trails.

> [!CAUTION]
> Super Admin credentials must **never** be shared with institution administrators, drivers, or students. The platform developer portal is separated from institutional dashboards by distinct JWT roles, database tables, and route authorization checks.

---

## 2. Secure Super Admin Authentication

### 2.1 Login Portal
- **URL:** `/super-admin-login.html`
- **Discreet Navigation:** Click the `"Platform Super Admin Portal"` link located in the footer of `index.html`.

### 2.2 Bootstrap Developer Account Setup
The application features a secure bootstrap authentication mechanism:
1. When deploying to Render or staging, set the following environment variables:
   ```bash
   SUPER_ADMIN_BOOTSTRAP_USER=superadmin
   SUPER_ADMIN_BOOTSTRAP_PASS=YourComplexPasswordAtLeast16Chars2026!
   ```
2. When the SQL migration `20261105_02_migrate_existing_data.sql` is executed in Supabase, the default `platform_admins` record is created with a bcrypt password hash.
3. The platform issues a signed JWT containing:
   ```json
   {
     "user_id": "<uuid>",
     "username": "superadmin",
     "role": "super_admin",
     "exp": "<8 hours>"
   }
   ```

---

## 3. Dashboard Features & Capabilities

```
+-----------------------------------------------------------------------------------------+
| Where Is My Bus       [Platform Developer Console]                 superadmin  [Logout] |
+-----------------------------------------------------------------------------------------+
| Total Institutions: 12  | Active: 11  | Inactive: 1  | Total Buses: 48 | Active Trips: 9|
+-----------------------------------------------------------------------------------------+
| [Institutions & Access Codes]  [Platform Audit Logs]                                    |
|                                                                                         |
| Search: [_________]  Filter: [All Status v]                [+ Register Institution]     |
|                                                                                         |
| Institution        Code     Type     Status    Code Status  Rotated     Admin Rotation  |
| Providence College PCE-001  College  Active    Active       05/11/2026  [Allowed]       |
| Kumaraguru College KCT-002  College  Active    Active       05/11/2026  [Disabled]      |
+-----------------------------------------------------------------------------------------+
```

### 3.1 Registering a New Institution
1. In the Super Admin Dashboard, click **"+ Register Institution"**.
2. Complete the form:
   - **Institution Name:** Full official name (e.g., `National Institute of Technology`).
   - **Unique Code / Prefix:** 3-8 character identifier (e.g., `NIT-003`). Must be unique.
   - **Type:** College, School, University, Institute, or Other.
   - **Location:** Address, District, and State.
   - **Contact Officer:** Name, Email, and Phone.
   - **Allow Administrator Rotation:** Check this box if you want the campus administrator to be able to rotate their own code. Leave unchecked for central platform control.
3. Click **"Register & Generate Code"**.
4. The **One-Time Access Code Reveal Modal** appears with the generated code (e.g., `WIMB-NIT-8K2D-4E1C-9A3B-7C5E`).
5. Click **"Copy Access Code"** and save it into a secure corporate password vault (e.g. 1Password / Bitwarden).
6. Securely communicate the code to the campus transit coordinator.

### 3.2 Rotating an Institution's Access Code
1. Locate the institution in the management table.
2. Under **Actions**, click the **Rotate Code** icon (`<i class="fas fa-arrows-rotate"></i>`).
3. Confirm the prompt warning that the old code will be invalidated immediately.
4. The One-Time Reveal Modal displays the new code.

### 3.3 Temporarily Deactivating an Institution
1. Under **Actions**, click the **Pause/Play** icon (`<i class="fas fa-pause"></i>`).
2. Setting an institution to **Inactive**:
   - Immediately blocks public code resolution for that institution.
   - Prevents new trip dispatches for buses of that institution.
   - Retains all existing student, bus, driver, and location historical records.

### 3.4 Revoking Access Code
1. Click the **Ban/Revoke** icon (`<i class="fas fa-ban"></i>`).
2. The current active code status is set to `'revoked'`.
3. The institution remains registered, but access is blocked until a replacement code is rotated.

### 3.5 Toggling Administrator Code Rotation Permission
- In the table column **Admin Rotation**, click the toggle button.
- Switched to **"Allowed"**: Campus admins can rotate their access code in their own Settings tab.
- Switched to **"Disabled"**: Campus admins attempting rotation receive an HTTP 403 Forbidden error.

---

## 4. Monitoring Platform Audit Logs

Navigate to the **Platform Audit Logs** tab in the dashboard to review an immutable audit trail of:
- `SUPER_ADMIN_LOGIN`: Timestamps, IP addresses, and user-agents of developer logins.
- `INSTITUTION_REGISTERED`: Detailed metadata of newly created institutions.
- `ACCESS_CODE_ROTATED`: Records of code rotations initiated by developers.
- `ACCESS_CODE_REVOKED`: Records of emergency revocations.
- `ADMIN_ROTATED_ACCESS_CODE`: Audit trail when a campus administrator rotates their code.
- `CODE_SETTINGS_UPDATED`: Changes to delegation permissions.

---

## 5. Security & Session Handling

- **JWT Expiry:** Super Admin tokens automatically expire after **8 hours**.
- **No In-Memory Secret Storage:** The Super Admin token is stored only in `sessionStorage` (`platform_token`) and cleared completely on logout.
- **Bfcache Protection:** Protected by server-side `Cache-Control: no-store` headers and client-side `pageshow` event handlers.
- **Hardened Endpoint Verification:** Every `/api/platform/*` route executes `requireSuperAdmin` to verify `req.user.role === 'super_admin'`.
