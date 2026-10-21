// ============================================================================
// SESSION PROTECTION — ROLE-ENFORCED ROUTE GUARD
// ============================================================================
// This module enforces portal isolation on the client. The backend ALWAYS
// re-validates roles via JWT + database. These guards are a first layer of
// UX defence — they do NOT replace server-side RLS or API authorization.
// ============================================================================

// ---------------------------------------------------------------------------
// JWT helpers (client-side only — NEVER used for actual authorization)
// ---------------------------------------------------------------------------
function _decodeJwtPayload(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64));
  } catch (e) {
    return null;
  }
}

function _isTokenExpired(token) {
  const payload = _decodeJwtPayload(token);
  if (!payload || !payload.exp) return true;
  return Date.now() / 1000 > payload.exp;
}

// ---------------------------------------------------------------------------
// Cross-portal contamination guard
// If a stale driver or admin session exists in storage while a student route
// is being accessed, clear those stale sessions immediately.
// This handles: a driver who logs out and then opens student-console.html —
// their driver token must not leak into student context.
// ---------------------------------------------------------------------------
function _clearStaffSessionsIfStudentContext() {
  // Clear driver session from student context
  const driverSession = (() => {
    try { return JSON.parse(localStorage.getItem('driverSession')); } catch(e) { return null; }
  })();
  if (driverSession) {
    console.warn('[Auth] Stale driverSession found on student route — clearing it.');
    localStorage.removeItem('driverSession');
  }

  // Clear admin session from student context
  const adminSession = (() => {
    try { return JSON.parse(sessionStorage.getItem('adminSession')); } catch(e) { return null; }
  })();
  if (adminSession) {
    console.warn('[Auth] Stale adminSession found on student route — clearing it.');
    sessionStorage.removeItem('adminSession');
  }
}

// ---------------------------------------------------------------------------
// Verify token with backend (network best-effort, never blocks on failure)
// ---------------------------------------------------------------------------
async function _verifyTokenWithBackend(token, expectedRole) {
  try {
    const backendUrl = (typeof BACKEND_URL !== 'undefined') ? BACKEND_URL : '';
    const res = await fetch(`${backendUrl}/api/auth/verify`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return { valid: false, reason: 'http_error' };
    const data = await res.json();
    if (!data.valid) return { valid: false, reason: 'token_invalid' };
    // Critical: server must confirm the role matches the portal being accessed
    if (data.user && data.user.role !== expectedRole) {
      return { valid: false, reason: 'role_mismatch', serverRole: data.user.role };
    }
    return { valid: true };
  } catch (e) {
    // Network unavailable — allow locally-valid unexpired token to proceed
    console.warn('[Auth] Backend verify unreachable. Trusting local session (token not expired).');
    return { valid: null, reason: 'network_error' };
  }
}

// ===========================================================================
// PUBLIC API: protectRoute(requiredRole)
// Call this at the top of every protected page.
//
// Usage:
//   protectRoute('student')  → protects student-console, student-dashboard
//   protectRoute('driver')   → protects driver-dashboard
//   protectRoute('admin')    → protects admin-dashboard, admin-sos
// ===========================================================================
async function protectRoute(requiredRole) {

  // ── ADMIN ROUTE ──────────────────────────────────────────────────────────
  if (requiredRole === 'admin') {
    const session = (() => {
      try { return JSON.parse(sessionStorage.getItem('adminSession')); } catch(e) { return null; }
    })();

    if (!session || !session.token || session.role !== 'admin') {
      console.warn('[Auth] No valid admin session. Redirecting to admin-login.');
      sessionStorage.removeItem('adminSession');
      window.location.replace('admin-login.html');
      return;
    }
    if (_isTokenExpired(session.token)) {
      console.warn('[Auth] Admin token expired. Redirecting.');
      sessionStorage.removeItem('adminSession');
      window.location.replace('admin-login.html');
      return;
    }
    // Backend verify
    const result = await _verifyTokenWithBackend(session.token, 'admin');
    if (result.valid === false) {
      console.warn('[Auth] Admin token rejected by backend:', result.reason, result.serverRole || '');
      sessionStorage.removeItem('adminSession');
      window.location.replace('admin-login.html');
      return;
    }
    // Passed all checks
    return;
  }

  // ── DRIVER ROUTE ─────────────────────────────────────────────────────────
  if (requiredRole === 'driver') {
    const session = (() => {
      try { return JSON.parse(localStorage.getItem('driverSession')); } catch(e) { return null; }
    })();

    if (!session || !session.driverId || !session.token || session.role !== 'driver') {
      console.warn('[Auth] No valid driver session. Redirecting to driver-login.');
      localStorage.removeItem('driverSession');
      window.location.replace('driver-login.html');
      return;
    }
    if (_isTokenExpired(session.token)) {
      console.warn('[Auth] Driver token expired. Redirecting.');
      localStorage.removeItem('driverSession');
      window.location.replace('driver-login.html');
      return;
    }
    // Backend verify
    const result = await _verifyTokenWithBackend(session.token, 'driver');
    if (result.valid === false) {
      console.warn('[Auth] Driver token rejected by backend:', result.reason, result.serverRole || '');
      localStorage.removeItem('driverSession');
      window.location.replace('driver-login.html');
      return;
    }
    // Passed all checks
    return;
  }

  // ── STUDENT / PUBLIC ROUTE ───────────────────────────────────────────────
  // First, evict any stale staff sessions from student context
  _clearStaffSessionsIfStudentContext();

  const localSession = (() => {
    try { return JSON.parse(localStorage.getItem('userSession')); } catch(e) { return null; }
  })();

  // Case 1: Valid JWT session
  if (localSession && localSession.token) {
    if (_isTokenExpired(localSession.token)) {
      console.warn('[Auth] Student token expired. Redirecting to login.');
      localStorage.removeItem('userSession');
      window.location.replace('student-login.html');
      return;
    }

    // SECURITY: If the stored role is 'driver' or 'admin', reject — they are
    // in the wrong portal. This covers the case where a driver's token was
    // somehow placed into userSession (e.g., a shared device scenario).
    const storedRole = localSession.role;
    if (storedRole && storedRole !== 'student' && storedRole !== 'parent' && storedRole !== 'teacher' && storedRole !== 'faculty') {
      console.warn('[Auth] userSession contains a non-student role:', storedRole, '— rejecting.');
      localStorage.removeItem('userSession');
      window.location.replace('student-login.html');
      return;
    }
    return; // Token is valid and role is appropriate
  }

  // Case 2: Demo session (offline mode)
  if (localSession && localSession.id && localSession.id.startsWith('demo-student-')) {
    return;
  }

  // Case 3: Supabase auth session fallback
  if (!window.supabase) {
    window.location.replace('student-login.html');
    return;
  }
  try {
    const { data: { session } } = await window.supabase.auth.getSession();
    if (!session) {
      window.location.replace('student-login.html');
    }
  } catch (e) {
    window.location.replace('student-login.html');
  }
}
