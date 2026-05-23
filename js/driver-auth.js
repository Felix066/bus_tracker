async function handleDriverLogin(username, password) {
  try {
    const { data, error } = await supabase.rpc('verify_driver', {
      input_username: username,
      input_password: password
    });

    if (error) throw new Error('Database function error: ' + error.message);
    if (!data.success) throw new Error(data.error);

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
