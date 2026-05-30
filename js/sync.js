let lastRenderedLat = null;
let lastRenderedLon = null;
const MIN_RENDER_MOVEMENT = 3;

function shouldUpdateMapRender(newLat, newLon) {
  return true;
}

function subscribeToBus(busId, tripType) {
  if (!window.supabase) return;
  const busLabel = busId.toLowerCase().includes('bus') ? 
                   busId.replace(/bus\s*/i, 'B').toUpperCase() : busId;

  supabase.channel(`bus-${busId}-live`)
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'computed_locations',
    filter: `bus_id=eq.${busId}`
  }, (payload) => {
    const { latitude, longitude } = payload.new;

    if (!shouldUpdateMapRender(latitude, longitude)) {
      console.log(`[Cache] Position unchanged for ${busId} - skipping map render`);
      return;
    }

    lastRenderedLat = latitude;
    lastRenderedLon = longitude;

    const old = busMarker ? busMarker.getLatLng() : null;
    if (!busMarker) {
      busMarker = L.marker([latitude, longitude], { icon: createBusIcon(busLabel) }).addTo(map);
    } else {
      animateMarker(busMarker, old.lat, old.lng, latitude, longitude, 2000);
      busMarker.setIcon(createBusIcon(busLabel));
    }
    map.panTo([latitude, longitude]);
  })
  .subscribe();
}


window.subscribeToBus = subscribeToBus;
``