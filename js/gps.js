let passengerWatchId = null;

function startPassengerGPS(tripId, busId, role) {
  if (passengerWatchId) return;

  const kalman = new KalmanFilter();

  passengerWatchId = setInterval(() => {
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const smoothed = kalman.process(
        pos.coords.latitude, pos.coords.longitude,
        pos.coords.accuracy, pos.timestamp
      );

      const { data: driver } = await supabase
        .from('bus_locations')
        .select('latitude, longitude')
        .eq('trip_id', tripId)
        .eq('source_role', 'driver')
        .order('submitted_at', { ascending: false })
        .limit(1).single();

      if (!driver) return;

      const dist = haversineDistance(smoothed.lat, smoothed.lon, driver.latitude, driver.longitude);
      const isAccepted = dist <= 10; // Fixed 10m threshold

      await supabase.from('bus_locations').insert({
        trip_id: tripId,
        bus_id: busId,
        source_role: role,
        latitude: smoothed.lat,
        longitude: smoothed.lon,
        is_accepted: isAccepted
      });
    }, null, { enableHighAccuracy: true });
  }, 3000);
}

function stopPassengerGPS() {
  if (passengerWatchId) {
    clearInterval(passengerWatchId);
    passengerWatchId = null;
  }
}

window.startPassengerGPS = startPassengerGPS;
window.stopPassengerGPS = stopPassengerGPS;
