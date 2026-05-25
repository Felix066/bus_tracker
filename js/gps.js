let passengerGpsInterval = null;

function roundCoord(value) {
  return Math.round(value * 10000) / 10000;
}

function startPassengerGPS(tripId, busId, role) {
  if (passengerGpsInterval) return;

  const getAndSendLocation = async (pos) => {
      // Prevent map drift by only accepting highly accurate passenger GPS
      if (pos.coords.accuracy > 50) {
        console.log('Passenger GPS ignored — accuracy > 50m:', pos.coords.accuracy);
        return;
      }

      const lat = roundCoord(pos.coords.latitude);
      const lon = roundCoord(pos.coords.longitude);

      // UPDATE 2 — Get driver latest location
      const { data: driver } = await supabase
        .from('bus_locations')
        .select('latitude, longitude')
        .eq('trip_id', tripId)
        .eq('source_role', 'driver')
        .order('submitted_at', { ascending: false })
        .limit(1).single();

      if (!driver) return;

      const dist = haversineDistance(lat, lon, driver.latitude, driver.longitude);
      const isAccepted = dist <= 10; // UPDATE 2 — 10 meters distance validation

      // UPDATE 20 — Bus-Specific Location Participation
      supabase.from('bus_locations').insert({
        trip_id: tripId,
        bus_id: busId,
        source_role: role,
        source_user_id: localStorage.getItem('source_user_id') || 'unknown',
        latitude: lat,
        longitude: lon,
        is_accepted: isAccepted
      }).then(({ error }) => {
        if (error) console.error("Error inserting passenger location:", error);
      });
  };

  // Trigger permission prompt immediately on user gesture
  navigator.geolocation.getCurrentPosition((pos) => {
      // First ping
      getAndSendLocation(pos);
      
      // Setup interval for subsequent pings
      if (!passengerGpsInterval) {
          passengerGpsInterval = setInterval(() => {
              navigator.geolocation.getCurrentPosition(getAndSendLocation, (err) => console.error(err), { enableHighAccuracy: true });
          }, 3000);
      }
  }, (err) => {
      console.error("Location permission denied or failed:", err);
  }, { enableHighAccuracy: true });
}

function stopPassengerGPS(tripId, busId, role) {
  if (passengerGpsInterval) {
    clearInterval(passengerGpsInterval);
    passengerGpsInterval = null;
  }

  // UPDATE 21 — Insert a final rejected row so they are excluded immediately
  navigator.geolocation.getCurrentPosition((pos) => {
    if (tripId && busId && role) {
      const lat = parseFloat(pos.coords.latitude.toFixed(4));
      const lon = parseFloat(pos.coords.longitude.toFixed(4));
      supabase.from('bus_locations').insert({
        trip_id:     tripId,
        bus_id:      busId,
        source_role: role,
        source_user_id: localStorage.getItem('source_user_id') || 'unknown',
        latitude:    lat,
        longitude:   lon,
        is_accepted: false  // immediately excluded from averaging
      }).then(({ error }) => {
        if (error) console.error("Error inserting final passenger location:", error);
      });
    }
  }, null, { enableHighAccuracy: true, timeout: 1000 });
}

// UPDATE 21 — Student Exit Handling
window.addEventListener('beforeunload', () => {
    const activeTripId = localStorage.getItem('activeTripId');
    const userRole = localStorage.getItem('userRole'); // student or faculty
    if (activeTripId && userRole) {
        stopPassengerGPS(activeTripId, 'Bus 4', userRole);
    }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    const activeTripId = localStorage.getItem('activeTripId');
    const userRole = localStorage.getItem('userRole');
    if (activeTripId && userRole) {
        stopPassengerGPS(activeTripId, 'Bus 4', userRole);
    }
  }
});

window.startPassengerGPS = startPassengerGPS;
window.stopPassengerGPS = stopPassengerGPS;

