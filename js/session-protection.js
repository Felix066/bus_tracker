// Helper: decode JWT payload without verification (client-side only)
function _decodeJwtPayload(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64));
  } catch (e) {
    return null;
  }
}

// Helper: check if JWT is expired
function _isTokenExpired(token) {
  const payload = _decodeJwtPayload(token);
  if (!payload || !payload.exp) return true;
  return Date.now() / 1000 > payload.exp;
}

async function protectRoute(requiredRole) {
  if (requiredRole === 'admin') {
    const session = JSON.parse(localStorage.getItem('adminSession'));
    if (!session || session.role !== 'admin' ||  !session.token) {
      window.location.href = 'driver-login.html';
      return;
    }
    // Reject clearly expired tokens immediately (no backend needed)
    if (_isTokenExpired(session.token)) {
      localStorage.removeItem('adminSession');
      window.location.href = 'driver-login.html';
      return;
    }
    // Verify token with backend — on network failure, trust local session
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/verify`, {
        headers: { 'Authorization': `Bearer ${session.token}` }
      });
      const data = await res.json();
      if (!data.valid || data.user.role !== 'admin') {
        localStorage.removeItem('adminSession');
        window.location.href = 'driver-login.html';
      }
    } catch(e) {
      // Backend unreachable — token not expired, trust local session
      console.warn('[Auth] Backend verify unreachable, trusting local admin session.');
    }

  } else if (requiredRole === 'driver') {
    const session = JSON.parse(localStorage.getItem('driverSession'));
    if (!session || !session.driverId || !session.token) {
      console.warn('[Auth] Driver session invalid or missing. Redirecting.');
      window.location.href = 'driver-login.html';
      return;
    }
    // Reject clearly expired tokens immediately (no backend needed)
    if (_isTokenExpired(session.token)) {
      localStorage.removeItem('driverSession');
      window.location.href = 'driver-login.html';
      return;
    }
    // Verify token with backend — on network failure, trust local session
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/verify`, {
        headers: { 'Authorization': `Bearer ${session.token}` }
      });
      const data = await res.json();
      if (!data.valid || data.user.role !== 'driver') {
        console.warn('[Auth] Driver token invalid on backend. Redirecting.');
        localStorage.removeItem('driverSession');
        window.location.href = 'driver-login.html';
      }
    } catch(e) {
      // Backend unreachable — token not expired, trust local session
      console.warn('[Auth] Backend verify unreachable, trusting local driver session.');
    }

  } else {
    const localSession = JSON.parse(localStorage.getItem('userSession'));
    if (localSession && (localSession.token || (localSession.id && localSession.id.startsWith('demo-student-')))) return;

    // Guard: supabase may be null if the CDN failed to load
    if (!window.supabase) {
      window.location.href = 'student-login.html';
      return;
    }
    const { data: { session } } = await window.supabase.auth.getSession();
    if (!session) {
      window.location.href = 'student-login.html';
    }
  }
}
