let map, busMarker, polyline;
const stopMarkers = [];

function createBusIcon(label = 'Bus') {
  let safeLabel = '';
  if (label !== null && label !== undefined) {
      safeLabel = String(label).replace(/[&<>'"]/g, tag => {
        switch (tag) {
          case '&': return '&amp;';
          case '<': return '&lt;';
          case '>': return '&gt;';
          case "'": return '&#39;';
          case '"': return '&quot;';
          default: return tag;
        }
      });
  } else {
      safeLabel = 'BUS';
  }

  return L.divIcon({
    className: 'custom-bus-icon',
    html: '<div style="display: flex; flex-direction: column; align-items: center; justify-content: center;">' +
          '<div style="font-size: 32px; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.3)); line-height: 1;">🚌</div>' +
          '<div style="background: #1e40af; color: white; font-weight: 800; font-size: 11px; padding: 2px 6px; border-radius: 12px; border: 2px solid white; margin-top: -8px; white-space: nowrap; box-shadow: 0 2px 4px rgba(0,0,0,0.2); text-transform: uppercase;">' + 
          safeLabel + '</div></div>',
    iconSize: [45, 45],
    iconAnchor: [22, 22]
  });
}

function initMap(tripType) {
  map = L.map('map').setView([9.1500, 76.7200], 11);

  // Multiple tile server URLs to try, in order of preference.
  // The first entry is a LOCAL PROXY running on the backend server —
  // it fetches tiles server-side (bypassing firewall blocks on the browser).
  var backendBase = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname === '')
    ? 'http://localhost:3001'
    : '';
  var tileServers = [
    { url: backendBase + '/tiles/{z}/{x}/{y}', attr: '&copy; OpenStreetMap contributors (via proxy)' },
    { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attr: '&copy; OpenStreetMap contributors' },
    { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', attr: '&copy; OpenStreetMap contributors' },
    { url: 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png', attr: '&copy; OpenStreetMap &copy; CARTO' },
    { url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', attr: '&copy; OpenStreetMap &copy; CARTO' }
  ];

  var currentIdx = 0;
  var errorCount = 0;
  var currentLayer = null;
  var switched = false; // prevents rapid looping

  function tryTileServer(idx) {
    if (idx >= tileServers.length) {
      console.error('[Map] All tile servers exhausted.');
      return;
    }
    currentIdx = idx;
    errorCount = 0;
    switched = false;
    var srv = tileServers[idx];
    console.log('[Map] Trying tile server ' + idx + ': ' + srv.url);

    if (currentLayer) {
      try { map.removeLayer(currentLayer); } catch(e) {}
    }

    currentLayer = L.tileLayer(srv.url, {
      attribution: srv.attr,
      maxZoom: 19
    });

    currentLayer.on('tileerror', function() {
      errorCount++;
      // If more than 3 tiles fail, switch to the next server
      if (errorCount > 3 && !switched) {
        switched = true;
        console.warn('[Map] Tile server ' + idx + ' failed (' + errorCount + ' errors). Trying next...');
        tryTileServer(idx + 1);
      }
    });

    currentLayer.addTo(map);
  }

  tryTileServer(0);

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

  // Auto-disable Follow Bus mode if user manually drags map
  map.on('dragstart', function() {
    if (window.isFollowBusEnabled) {
      if (typeof window.toggleFollowBusMode === 'function') {
        window.toggleFollowBusMode(); // Toggle it off
      }
    }
  });

  return map;
}

function prewarmTileCache(map) {
  // Pre-warming disabled — was creating hidden map instances that fail on blocked networks
  console.log('[Cache] Tile pre-warming skipped (uses live tile server)');
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

if (typeof window.isFollowBusEnabled === 'undefined') {
  window.isFollowBusEnabled = true; // Auto-follow bus by default
}

let lastMarkerUpdateTime = 0;

function updateBusMarker(lat, lon, label = 'Bus') {
    const targetZoom = (map && map.getZoom() < 13) ? 15 : (map ? map.getZoom() : 15);
    const now = Date.now();
    
    if (!busMarker) {
        busMarker = L.marker([lat, lon], { icon: createBusIcon(label) }).addTo(map);
        map.setView([lat, lon], targetZoom);
        if (typeof checkNearbyAlert === 'function') checkNearbyAlert(lat, lon);
        lastMarkerUpdateTime = now;
    } else {
        const oldPos = busMarker.getLatLng();
        let distance = 100;
        if (typeof haversineDistance === 'function') {
            distance = haversineDistance(oldPos.lat, oldPos.lng, lat, lon);
        }
        
        if (distance >= 1) { // 1 meter threshold for smooth responsive tracking
            // Calculate dynamic duration based on update frequency to avoid stop-and-go
            let duration = 2500; 
            if (lastMarkerUpdateTime > 0) {
                duration = now - lastMarkerUpdateTime;
                // Cap to reasonable limits (between 1.5s and 5s)
                if (duration < 1500) duration = 1500;
                if (duration > 5000) duration = 5000;
            }
            lastMarkerUpdateTime = now;
            
            animateMarker(busMarker, oldPos.lat, oldPos.lng, lat, lon, duration);
            busMarker.setIcon(createBusIcon(label));
            if (window.isFollowBusEnabled !== false && map) {
                map.panTo([lat, lon], { animate: true, duration: duration / 1000 });
            }
            if (typeof checkNearbyAlert === 'function') checkNearbyAlert(lat, lon);
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
  stopMarkers.forEach((marker, i) => {
    if (i <= maxReachedStopIndex && marker) {
      marker.setStyle({ fillColor: '#10B981', color: '#047857' });
    }
  });
}

window.initMap = initMap;
window.updateBusMarker = updateBusMarker;
window.markStopVisited = markStopVisited;
window.setMaxReachedStopIndex = setMaxReachedStopIndex;
window.cacheCurrentLocation = cacheCurrentLocation;
window.showCachedLocationIfAvailable = showCachedLocationIfAvailable;
