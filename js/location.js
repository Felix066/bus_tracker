const INCLUSION_RADIUS = 10; // meters

function computeFinalPosition(allAcceptedLocations) {
  if (allAcceptedLocations.length === 0) return null;
  const totalLat = allAcceptedLocations.reduce((sum, l) => sum + l.lat, 0);
  const totalLon = allAcceptedLocations.reduce((sum, l) => sum + l.lon, 0);
  return {
    lat: totalLat / allAcceptedLocations.length,
    lon: totalLon / allAcceptedLocations.length
  };
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
