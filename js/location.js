const INCLUSION_RADIUS = 10; // meters

// UPDATE 3 & 22 — Averaging logic
function computeFinalPosition(latestLocations) {
  if (latestLocations.length === 0) return null;

  // Works with just driver alone — or driver + any passengers
  const totalLat = latestLocations.reduce((s, l) => s + l.latitude,  0);
  const totalLon = latestLocations.reduce((s, l) => s + l.longitude, 0);

  return {
    lat: totalLat / latestLocations.length,
    lon: totalLon / latestLocations.length
  };
}

// UPDATE 3 & 20 — Fetch the most recent location per user
async function getLatestAcceptedLocations(tripId, busId) {
  const { data } = await supabase
    .from('bus_locations')
    .select('source_role, source_user_id, latitude, longitude, submitted_at')
    .eq('trip_id', tripId)
    .eq('bus_id', busId) // UPDATE 20 — Filter by bus_id
    .eq('is_accepted', true)
    .order('submitted_at', { ascending: false });

  if (!data) return [];

  const latestPerUser = {};
  data.forEach(row => {
    const key = row.source_role + '_' + row.source_user_id;
    if (!latestPerUser[key]) latestPerUser[key] = row;
  });

  return Object.values(latestPerUser);
}

async function checkProximityToDriver(activeTripId) {
  const { data: driverLoc } = await supabase
    .from('bus_locations')
    .select('latitude, longitude')
    .eq('trip_id', activeTripId)
    .eq('source_role', 'driver')
    .order('submitted_at', { ascending: false })
    .limit(1).single();

  if (!driverLoc) return false;

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition((pos) => {
      const dist = haversineDistance(
        pos.coords.latitude, pos.coords.longitude,
        driverLoc.latitude, driverLoc.longitude
      );
      resolve(dist <= INCLUSION_RADIUS);
    }, () => resolve(false), { enableHighAccuracy: true });
  });
}

window.checkProximityToDriver = checkProximityToDriver;
window.computeFinalPosition = computeFinalPosition;
window.getLatestAcceptedLocations = getLatestAcceptedLocations;

