async function handleDriverLogin(username, password) {
  try {
    // Authenticate Driver via secure backend API
    const driverRes = await fetch(`${BACKEND_URL}/api/auth/login-driver`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    
    let driverData;
    const textRes = await driverRes.text();
    try {
      driverData = JSON.parse(textRes);
    } catch (e) {
      if (!driverRes.ok) {
        throw new Error(textRes || 'Login failed with status ' + driverRes.status);
      } else {
        throw new Error('Invalid response from server');
      }
    }
    
    if (!driverRes.ok) throw new Error(driverData.error || 'Invalid username or password');

    const session = {
      role: 'driver',
      driverId: driverData.driver.id, // Use actual UUID, not username
      assignedBus: driverData.driver.assignedBus,
      username: driverData.driver.username,
      token: driverData.token
    };

    localStorage.setItem('driverSession', JSON.stringify(session));

    // The backend now automatically handles registering the driver session in realtime
    // via the /api/auth/login-driver endpoint.

    window.location.href = 'driver-dashboard.html';
    
  } catch (err) {
    throw new Error('Login failed: ' + err.message);
  }
}



async function driverLogout() {
  const session = JSON.parse(localStorage.getItem('driverSession'));
  if (session && session.token) {
    try {
      await fetch(`${BACKEND_URL}/api/auth/logout-driver`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.token}` }
      });
    } catch(e) {
      console.warn("Logout ping failed", e);
    }
  }
  localStorage.removeItem('driverSession');
  window.location.href = 'driver-login.html';
}
