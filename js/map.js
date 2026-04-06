let map, busMarker, polyline;
const stopMarkers = [];

const busIcon = L.divIcon({
  className: '',
  html: '<div style="font-size:28px;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.4))">🚌</div>',
  iconSize: [36, 36],
  iconAnchor: [18, 18]
});

function initMap(tripType) {
  map = L.map('map').setView([9.1500, 76.7200], 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(map);

  const route = getRoute(tripType);
  const coords = route.map(s => [s.lat, s.lon]);

  polyline = L.polyline(coords, {
    color: '#3B82F6',
    weight: 4,
    dashArray: '10,5'
  }).addTo(map);

  route.forEach((stop, i) => {
    const m = L.circleMarker([stop.lat, stop.lon], {
      radius: 8,
      color: '#1E40AF',
      fillColor: '#FFFFFF',
      fillOpacity: 1,
      weight: 2
    }).addTo(map).bindPopup(stop.name);
    stopMarkers[i] = m;
  });

  return map;
}

function updateBusMarker(lat, lon) {
  if (!busMarker) {
    busMarker = L.marker([lat, lon], { icon: busIcon }).addTo(map);
  } else {
    busMarker.setLatLng([lat, lon]);
  }
  map.panTo([lat, lon]);
}

function markStopVisited(index) {
  if (stopMarkers[index]) {
    stopMarkers[index].setStyle({
      fillColor: '#22c55e',
      color: '#15803d'
    });
  }
}

window.initMap = initMap;
window.updateBusMarker = updateBusMarker;
window.markStopVisited = markStopVisited;
