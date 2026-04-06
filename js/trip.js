let tripWatchId = null;
let currentStopIndex = 0;
let lastLat, lastLon, lastTime;

async function startTrip() {
  const busId = document.getElementById('bus-select').value;
  const tripType = document.getElementById('trip-select').value;
  const driver = JSON.parse(localStorage.getItem('driverSession'));

  if (!busId) { alert('Select a bus'); return; }

  const { data: trip, error } = await supabase.from('trips').insert({
    bus_id: busId,
    driver_id: driver.driverId,
    trip_type: tripType,
    status: 'active'
  }).select().single();

  if (error) { console.error(error); return; }

  localStorage.setItem('activeTripId', trip.id);
  localStorage.setItem('activeBusId', busId);
  localStorage.setItem('activeTripType', tripType);

  startDriverTracking(trip.id, busId, tripType);
  startTripTimer();

  const btn = document.getElementById('start-btn');
  btn.textContent = 'End Trip';
  btn.style.background = '#DC2626';
  btn.onclick = endTrip;
}

function startDriverTracking(tripId, busId, tripType) {
  const kalman = new KalmanFilter();

  tripWatchId = navigator.geolocation.watchPosition(async (pos) => {
    const smoothed = kalman.process(
      pos.coords.latitude, pos.coords.longitude,
      pos.coords.accuracy, pos.timestamp
    );

    let speedKmh = 0;
    const now = Date.now();
    if (lastLat && lastLon) {
      const dist = haversineDistance(lastLat, lastLon, smoothed.lat, smoothed.lon);
      const timeSec = (now - lastTime) / 1000;
      if (timeSec > 0) speedKmh = ((dist / timeSec) * 3.6).toFixed(1);
    }
    lastLat = smoothed.lat; lastLon = smoothed.lon; lastTime = now;

    const speedDisplay = document.getElementById('speed-display');
    if (speedDisplay) speedDisplay.textContent = speedKmh + ' km/h';

    // 1. Save raw driver location
    await supabase.from('bus_locations').insert({
      trip_id: tripId, bus_id: busId, source_role: 'driver',
      latitude: smoothed.lat, longitude: smoothed.lon, is_accepted: true
    });

    // 2. Fetch all accepted locs for this trip
    const { data: locals } = await supabase
      .from('bus_locations')
      .select('latitude, longitude')
      .eq('trip_id', tripId)
      .eq('is_accepted', true)
      .order('submitted_at', { ascending: false })
      .limit(20);

    // 3. Compute final position
    const final = computeFinalPosition(locals.map(l => ({ lat: l.latitude, lon: l.longitude })));

    if (final) {
      await supabase.from('computed_locations').insert({
        trip_id: tripId, bus_id: busId,
        latitude: final.lat, longitude: final.lon,
        speed_kmh: speedKmh
      });
    }

    checkStopArrival(smoothed.lat, smoothed.lon, tripType, tripId);
  }, err => console.error(err), { enableHighAccuracy: true });
}

async function checkStopArrival(lat, lon, tripType, tripId) {
  const route = getRoute(tripType);
  if (currentStopIndex >= route.length) return;

  const next = route[currentStopIndex];
  const dist = haversineDistance(lat, lon, next.lat, next.lon);

  if (dist <= 50) {
    await supabase.from('stop_arrivals').insert({
      trip_id: tripId, stop_name: next.name, stop_index: currentStopIndex
    });
    currentStopIndex++;

    const nextStopDisplay = document.getElementById('next-stop-display');
    if (nextStopDisplay) {
      nextStopDisplay.textContent = currentStopIndex < route.length ? route[currentStopIndex].name : 'Arrived';
    }
  }
}

async function endTrip() {
  const tripId = localStorage.getItem('activeTripId');
  await supabase.from('trips')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', tripId);

  navigator.geolocation.clearWatch(tripWatchId);
  stopTripTimer();

  localStorage.removeItem('activeTripId');
  localStorage.removeItem('activeBusId');
  localStorage.removeItem('activeTripType');

  location.reload();
}

window.startTrip = startTrip;
window.endTrip = endTrip;
