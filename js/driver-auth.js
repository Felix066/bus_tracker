async function handleDriverLogin(username, password) {
  const { data: driver, error } = await supabase
    .from('drivers')
    .select('*')
    .eq('username', username)
    .single();

  if (error || !driver) {
    throw new Error('Invalid credentials');
  }

  // NOTE: In production, password checking should be done on the server (Edge Function)
  // For demonstration, we assume verify-driver edge function handles bcrypt
  // But here's a placeholder logic using localStorage as if the function was successful
  const session = {
    role: 'driver',
    driverId: driver.id,
    busId: driver.assigned_bus,
    username: driver.username
  };

  localStorage.setItem('driverSession', JSON.stringify(session));
  window.location.href = 'driver-dashboard.html';
}
