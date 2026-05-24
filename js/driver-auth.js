async function handleDriverLogin(username, password) {
  try {
    // 1. Attempt Admin Login via secure database RPC (No static hardcoded admin passwords)
    const { data: isAdmin, error: adminErr } = await supabase.rpc('admin_login', {
      p_username: username,
      p_password: password
    });

    if (isAdmin) {
      const session = { role: 'admin', username: username };
      localStorage.setItem('adminSession', JSON.stringify(session));
      window.location.href = 'admin-dashboard.html';
      return;
    }

    // 2. Fallback to Driver Login
    const { data, error } = await supabase.rpc('verify_driver', {
      input_username: username,
      input_password: password
    });

    if (error) throw new Error('Database function error: ' + error.message);
    if (!data.success) throw new Error('Invalid username or password');

    const session = {
      role: 'driver',
      driverId: data.driver.driverId,
      assignedBus: data.driver.assignedBus,
      username: data.driver.username
    };

    localStorage.setItem('driverSession', JSON.stringify(session));
    window.location.href = 'driver-dashboard.html';
    
  } catch (err) {
    throw new Error('Login failed: ' + err.message);
  }
}

function driverLogout() {
  localStorage.removeItem('driverSession');
  window.location.href = 'driver-login.html';
}
