async function protectRoute(requiredRole) {
  if (requiredRole === 'admin') {
    const session = JSON.parse(localStorage.getItem('adminSession'));
    if (!session || session.role !== 'admin' || !session.token) {
      window.location.href = 'driver-login.html';
      return;
    }
    // Verify token with backend
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
      window.location.href = 'driver-login.html';
    }
  } else if (requiredRole === 'driver') {
    const session = JSON.parse(localStorage.getItem('driverSession'));
    if (!session || !session.driverId || !session.token) {
      alert('Kicked out: Missing session data in localStorage. driverId=' + (session ? session.driverId : 'null') + ', token=' + (session ? !!session.token : 'null'));
      window.location.href = 'driver-login.html';
      return;
    }
    // Verify token with backend
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/verify`, {
        headers: { 'Authorization': `Bearer ${session.token}` }
      });
      const data = await res.json();
      if (!data.valid || data.user.role !== 'driver') {
        alert('Kicked out: Token validation failed on backend. valid=' + data.valid + ', role=' + (data.user ? data.user.role : 'undefined'));
        localStorage.removeItem('driverSession');
        window.location.href = 'driver-login.html';
      }
    } catch(e) {
      alert('Kicked out: fetch to /api/auth/verify threw an error: ' + e.message);
      window.location.href = 'driver-login.html';
    }
  } else {
    const localSession = JSON.parse(localStorage.getItem('userSession'));
    if (localSession && localSession.id && localSession.id.startsWith('demo-student-')) return; // allow demo

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      window.location.href = 'index.html';
    }
  }
}
