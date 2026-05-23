async function protectRoute(requiredRole) {
  if (requiredRole === 'driver') {
    const session = JSON.parse(localStorage.getItem('driverSession'));
    if (!session || !session.driverId) {
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
