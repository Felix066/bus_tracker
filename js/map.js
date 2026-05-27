let map, busMarker, polyline;
const stopMarkers = [];

function createBusIcon(label = 'Bus') {
  return L.divIcon({
    className: 'custom-bus-icon',
    html: `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center;">
        <div style="font-size: 32px; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.3)); line-height: 1;">🚌</div>
        <div style="
          background: #1e40af; 
          color: white; 
          font-weight: 800; 
          font-size: 11px; 
          padding: 2px 6px; 
          border-radius: 12px; 
          border: 2px solid white; 
          margin-top: -8px; 
          white-space: nowrap;
          box-shadow: 0 2px 4px rgba(0,0,0,0.2);
          text-transform: uppercase;
        ">${label}</div>
      </div>
    `,
    iconSize: [45, 45],
    iconAnchor: [22, 22]
  });
}

function initMap(tripType) {
  map = L.map('map').setView([9.1500, 76.7200], 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(map);

  const route = getRoute(tripType);
  const coords = route.map(s => [s.lat, s.lon]);

  // Draw Route Polyline
  // polyline = L.polyline(coords, { color: '#2563EB', weight: 4, opacity: 0.8 }).addTo(map);

  // Draw Stop Markers
  // route.forEach((stop, i) => {
  //   const marker = L.circleMarker([stop.lat, stop.lon], {
  //     radius: 6,
  //     fillColor: 'white',
  //     color: '#2563EB',
  //     weight: 2,
  //     fillOpacity: 1
  //   }).addTo(map).bindPopup(stop.name);
  //   stopMarkers.push(marker);
  // });

  showCachedLocationIfAvailable();
  prewarmTileCache(map);
  return map;
}

function prewarmTileCache(map) {
  const routeBounds = L.latLngBounds(
    [8.9900, 76.6200],
    [9.3400, 76.8100]
  );

  const boundsCenter = routeBounds.getCenter();
  console.log('[Cache] Tile pre-warming started for Bus 4 route area');

  [10, 11, 12].forEach(zoom => {
    const div = document.createElement('div');
    div.style.display = 'none';
    document.body.appendChild(div);
    const tempMap = L.map(div).setView(boundsCenter, zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '',
      maxZoom: 14,
      minZoom: 10
    }).addTo(tempMap);
    setTimeout(() => {
      tempMap.remove();
      document.body.removeChild(div);
    }, 5000);
  });
}

const LOCATION_CACHE_KEY = 'bustrack_last_location';

function cacheCurrentLocation(lat, lon, accuracy) {
  try {
    localStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify({
      lat: lat,
      lon: lon,
      accuracy: accuracy,
      timestamp: Date.now()
    }));
    console.log('[Cache] Location saved:', lat, lon);
  } catch {
    console.warn('[Cache] Could not save location');
  }
}

function getCachedLocation() {
  try {
    const cached = localStorage.getItem(LOCATION_CACHE_KEY);
    if (!cached) return null;
    const parsed = JSON.parse(cached);
    const ageMinutes = (Date.now() - parsed.timestamp) / 60000;
    if (ageMinutes > 10) {
      console.log('[Cache] Cached location too old:', ageMinutes.toFixed(1), 'minutes');
      return null;
    }
    console.log('[Cache] Using cached location from', ageMinutes.toFixed(1), 'minutes ago');
    return parsed;
  } catch {
    return null;
  }
}

function showCachedLocationIfAvailable() {
  const cached = getCachedLocation();
  if (!cached) return;

  if (!busMarker) {
    busMarker = L.marker([cached.lat, cached.lon], { icon: createBusIcon() }).addTo(map);
  } else {
    busMarker.setLatLng([cached.lat, cached.lon]);
  }
  map.setView([cached.lat, cached.lon], 14);

  const ageSeconds = Math.floor((Date.now() - cached.timestamp) / 1000);
  console.log('[Cache] Showing last known location', ageSeconds, 'seconds old');
}

// UPDATE 9 — Smooth Map Marker Movement
function animateMarker(marker, fromLat, fromLon, toLat, toLon, durationMs) {
    const startTime = performance.now();
  
    function step(currentTime) {
      const elapsed  = currentTime - startTime;
      const progress = Math.min(elapsed / durationMs, 1);
      const lat      = fromLat + (toLat - fromLat) * progress;
      const lon      = fromLon + (toLon - fromLon) * progress;
      marker.setLatLng([lat, lon]);
      if (progress < 1) requestAnimationFrame(step);
    }
  
    requestAnimationFrame(step);
}

function updateBusMarker(lat, lon, label = 'Bus') {
    if (!busMarker) {
        busMarker = L.marker([lat, lon], { icon: createBusIcon(label) }).addTo(map);
        map.setView([lat, lon], map.getZoom());
    } else {
        const oldPos = busMarker.getLatLng();
        // Use haversineDistance if available to check movement threshold (e.g., 3 meters)
        let distance = 100; // default to rendering if haversine isn't defined
        if (typeof haversineDistance === 'function') {
            distance = haversineDistance(oldPos.lat, oldPos.lng, lat, lon);
        }
        
        if (distance >= 3) { // 3 meters threshold
            animateMarker(busMarker, oldPos.lat, oldPos.lng, lat, lon, 2500);
            busMarker.setIcon(createBusIcon(label));
            
            // Continuous Automatic Map Pan Issue: Only pan if explicitly enabled
            if (window.isFollowBusEnabled) {
                map.panTo([lat, lon], { animate: true, duration: 2.5 });
            }
        }
    }
}


let maxReachedStopIndex = -1;

function setMaxReachedStopIndex(index) {
  if (index > maxReachedStopIndex) {
    maxReachedStopIndex = index;
  }
}

function markStopVisited(index) {
  if (index > maxReachedStopIndex) {
    maxReachedStopIndex = index;
    console.log('Progress Update: Stop', index, 'reached');
  }

  // Turn all stops up to the reached index green
  for (let i = 0; i <= maxReachedStopIndex; i++) {
    if (stopMarkers[i]) {
      stopMarkers[i].setStyle({ fillColor: '#10B981', color: '#047857' });
    }
  }
}

window.initMap = initMap;
window.updateBusMarker = updateBusMarker;
window.markStopVisited = markStopVisited;
window.setMaxReachedStopIndex = setMaxReachedStopIndex;
window.cacheCurrentLocation = cacheCurrentLocation;
window.showCachedLocationIfAvailable = showCachedLocationIfAvailable;
