// js/student-console.js

let activeTripId = null;
let currentTripType = null;
let busId = null;

let lastReverseGeocodeTime = 0;
let lastReverseGeocodeLat = null;
let lastReverseGeocodeLon = null;

let globalTripStartTime = null;

// Student GPS coords (updated by watchPosition)
let studentLatGlobal = null;
let studentLonGlobal = null;
let studentAccuracyGlobal = null;

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Get Bus ID from URL
    const params = new URLSearchParams(window.location.search);
    const busParam = params.get('bus'); // e.g. "Bus4"
    if (!busParam) {
        window.location.href = 'student-dashboard.html';
        return;
    }
    const busNum = busParam.replace(/\D/g, '');
    busId = busNum ? `Bus ${busNum}` : busParam.trim();

    // 1b. Load destination from admin (road-eta.js) — non-blocking
    if (typeof RoadETA !== 'undefined') {
        RoadETA.init().catch(() => {});
    }

    // 2. Fetch Active Trip and Initial Location in parallel
    const trip = await getTripInfo(busId);
    const locData = await getBusLocation(busId);
    
    const locRes = { data: locData ? [locData] : null };

    // 3. Fetch Driver Details (Do this early so the UI updates)
    let driverName = 'Unknown Driver';
    try {
        const res = await fetch(`${BACKEND_URL}/api/public/bus-status/${busId}`);
        if (res.ok) {
            const data = await res.json();
            if (data.session_driver) driverName = data.session_driver;
            else if (data.bus_driver) driverName = data.bus_driver;
        }
    } catch(e) {}

    const driverEl = document.getElementById('driver-name-display');
    if (driverEl) driverEl.textContent = driverName;
    const busLabelEl = document.getElementById('assigned-bus-label');
    if (busLabelEl) busLabelEl.textContent = busId;

    if (!trip) {
        const locEl = document.getElementById('location-display');
        if (locEl) locEl.textContent = 'Bus at Depot — No active trip for ' + busId;
        initMap('morning');
        
        let startLat = (locRes.data && locRes.data[0] && locRes.data[0].latitude) ? locRes.data[0].latitude : null;
        let startLon = (locRes.data && locRes.data[0] && locRes.data[0].longitude) ? locRes.data[0].longitude : null;
        if (!startLat) {
            const routeStops = (typeof getRoute === 'function') ? getRoute('morning') : [];
            startLat = (routeStops && routeStops[0]) ? routeStops[0].lat : 8.8932;
            startLon = (routeStops && routeStops[0]) ? routeStops[0].lon : 76.6141;
        }
        processNewLocation(startLat, startLon, 0);
        subscribeToLiveUpdates();
        return;
    }

    activeTripId = trip.id;
    currentTripType = trip.trip_type;
    const isTripActive = trip.status === 'active';

    try {
        const res = await fetch(`${BACKEND_URL}/api/public/bus-status/${busId}`);
        if (res.ok) {
            const data = await res.json();
            if (!isTripActive) {
                handleTripEnded();
            }
        }
    } catch(e) {}

    // 4. Initialize Map and Timer
    initMap(currentTripType || 'morning');
    
    const statusBar = document.getElementById('trip-status-bar');
    if (isTripActive && statusBar) {
        statusBar.classList.add('visible');
    }
    
    if (isTripActive && trip && trip.started_at) {
        globalTripStartTime = new Date(trip.started_at).getTime();
        startTripTimer(globalTripStartTime);
    }

    // 5. Display Initial Location Immediately (with route fallback if DB has no pings yet)
    let initialLat = null, initialLon = null, initialSpeed = 0;
    if (locRes.data && locRes.data.length > 0 && locRes.data[0] && locRes.data[0].latitude) {
        initialLat = locRes.data[0].latitude;
        initialLon = locRes.data[0].longitude;
        initialSpeed = locRes.data[0].speed_kmh || 0;
    }

    if (!initialLat) {
        try {
            const res = await fetch(`${BACKEND_URL}/api/location/bus/${encodeURIComponent(busId)}`);
            if (res.ok) {
                const json = await res.json();
                if (json && json.location && json.location.latitude) {
                    initialLat = json.location.latitude;
                    initialLon = json.location.longitude;
                    initialSpeed = json.location.speed_kmh || 0;
                }
            }
        } catch(e) {}
    }

    // Default route start fallback if no pings exist anywhere yet
    if (!initialLat) {
        const routeStops = (typeof getRoute === 'function') ? getRoute(currentTripType || 'morning') : [];
        initialLat = (routeStops && routeStops[0]) ? routeStops[0].lat : 8.8932;
        initialLon = (routeStops && routeStops[0]) ? routeStops[0].lon : 76.6141;
        initialSpeed = 0;
    }

    // Render initial location immediately on map and cards
    processNewLocation(initialLat, initialLon, initialSpeed);

    // 6. Subscribe to Realtime Updates
    subscribeToLiveUpdates();

    // 7. Auto-detect student position for personal stop AI ETA
    // This is now handled by checkLocationSharingPrompt() and watchPosition

    if (isTripActive) {
        checkLocationSharingPrompt();
    }
});

function subscribeToLiveUpdates() {
    supabase.channel(`bus-${busId}-live`)
        .on('postgres_changes', {
            event: '*', // Listen to INSERT and UPDATE since we are using UPSERT
            schema: 'public',
            table: 'current_bus_locations'
        }, (payload) => {
            if (payload.new) {
                const payloadBusId = (payload.new.bus_id || '').replace(/\s+/g, '').toLowerCase();
                const expectedBusId = busId.replace(/\s+/g, '').toLowerCase();
                if (payloadBusId === expectedBusId) {
                    processNewLocation(payload.new.latitude, payload.new.longitude, payload.new.speed_kmh);
                    if (payload.new.trip_id && !activeTripId) {
                        activeTripId = payload.new.trip_id;
                        // Reload to fully initialize active trip UI
                        location.reload();
                    }
                }
            }
        })
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'driver_sessions'
        }, (payload) => {
            if (payload.new) {
                const payloadBusId = (payload.new.bus_id || '').replace(/\s+/g, '').toLowerCase();
                const expectedBusId = busId.replace(/\s+/g, '').toLowerCase();
                if (payloadBusId === expectedBusId) {
                    if (payload.new.is_online === false) {
                        handleDriverOffline();
                    } else if (payload.new.is_online === true) {
                        handleDriverOnline();
                    }
                }
            }
        })
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'trips'
        }, (payload) => {
            if (payload.new && payload.new.id === activeTripId) {
                if (payload.new.status === 'completed' || payload.new.status === 'cancelled') {
                    handleTripEnded();
                }
            }
        })
        .subscribe();

    // Fallback: Check driver and trip status every 3 seconds
    // This guarantees instant updates even if Supabase Realtime is not enabled for these tables
    setInterval(async () => {
        try {
            const queryUrl = activeTripId 
                ? `${BACKEND_URL}/api/public/bus-status/${busId}?trip_id=${activeTripId}`
                : `${BACKEND_URL}/api/public/bus-status/${busId}`;
            const res = await fetch(queryUrl);
            if (res.ok) {
                const data = await res.json();
                
                // 1. Check if trip ended
                if (activeTripId && (data.trip_status === 'completed' || data.trip_status === 'cancelled')) {
                    handleTripEnded();
                    return;
                }
            }
            
            // 2. Fetch live location as fallback for Realtime
            const locRes = await fetch(`${BACKEND_URL}/api/location/bus/${busId}`);
            if (locRes.ok) {
                const locData = await locRes.json();
                if (locData.success && locData.location) {
                    const loc = locData.location;
                    if (loc.latitude && loc.longitude) {
                        // Process location update always, to update lastGPSTime
                        processNewLocation(loc.latitude, loc.longitude, loc.speed_kmh);
                    }
                }
            }
        } catch(e) {}

        // 3. Check for app crash / forced close (no GPS for 90s)
        if (lastGPSTime > 0) {
            const timeDiffMs = Date.now() - lastGPSTime;
            if (timeDiffMs > 90000) { 
                handleDriverOffline();
            }
        }
    }, 3000);
}

function handleDriverOffline() {
    if (deadReckonTimer) clearInterval(deadReckonTimer);
    
    const statusBar = document.getElementById('trip-status-bar');
    const statusText = document.getElementById('trip-status-text');
    const statusDot = statusBar ? statusBar.querySelector('[class^="status-dot"]') : null;
    
    if (statusBar && statusText) {
        statusBar.classList.add('visible'); // MAKE VISIBLE
        statusBar.style.background = 'rgba(239, 68, 68, 0.1)';
        statusBar.style.border = '1px solid rgba(239, 68, 68, 0.2)';
        statusText.textContent = 'Driver Offline — Last known location';
        statusText.style.color = '#ef4444';
        if (statusDot) {
            statusDot.style.background = '#ef4444';
            statusDot.style.boxShadow = '0 0 8px #ef4444';
        }
    }
}

function handleTripEnded() {
    if (deadReckonTimer) clearInterval(deadReckonTimer);

    const statusBar = document.getElementById('trip-status-bar');
    const statusText = document.getElementById('trip-status-text');
    const statusDot = statusBar ? statusBar.querySelector('[class^="status-dot"]') : null;
    
    if (statusBar && statusText) {
        statusBar.classList.add('visible'); // MAKE VISIBLE
        statusBar.style.background = 'rgba(245, 158, 11, 0.1)';
        statusBar.style.border = '1px solid rgba(245, 158, 11, 0.2)';
        statusText.textContent = 'Trip Ended';
        statusText.style.color = '#f59e0b';
        if (statusDot) {
            statusDot.style.background = '#f59e0b';
            statusDot.style.boxShadow = '0 0 8px #f59e0b';
        }
    }
    const speedDisplay = document.getElementById('speed-display');
    if (speedDisplay) speedDisplay.textContent = '0 km/h';
    
    if (typeof stopTripTimer === 'function') stopTripTimer();
    
    const locationDisplay = document.getElementById('location-display');
    if (locationDisplay) locationDisplay.textContent = '-';
    
    if (window.busMarker && window.map) {
        window.map.removeLayer(window.busMarker);
        window.busMarker = null;
    }
}

function handleDriverOnline() {
    const statusBar = document.getElementById('trip-status-bar');
    const statusText = document.getElementById('trip-status-text');
    const statusDot = statusBar ? statusBar.querySelector('[class^="status-dot"]') : null;
    
    // Only restore green status if the trip hasn't ended.
    if (activeTripId) {
        fetch(`${BACKEND_URL}/api/public/bus-status/${busId}?trip_id=${activeTripId}`)
            .then(res => res.json())
            .then(data => {
                if (data && data.trip_status === 'active') {
                    if (statusBar && statusText) {
                        statusBar.classList.add('visible');
                        statusBar.style.background = '#F0FDF6';
                        statusBar.style.border = '1px solid #BBF0D6';
                        statusText.textContent = 'Trip active — GPS tracking live';
                        statusText.style.color = '#2A7D55';
                        if (statusDot) {
                            statusDot.className = 'status-dot-green';
                            statusDot.style.background = '#2A7D55';
                            statusDot.style.boxShadow = 'none';
                        }
                    }
                    
                    // Restart timer synchronized with actual trip start time
                    if (globalTripStartTime && typeof startTripTimer === 'function') {
                        startTripTimer(globalTripStartTime);
                    }
                }
            }).catch(e => console.error(e));
    }
}

let lastGPSLat = null;
let lastGPSLon = null;
let lastGPSTime = 0;
let lastGPSSpeedKmh = 30;
let deadReckonTimer = null;
const MAX_DEAD_RECKON_TIME_MS = 60000;

function processNewLocation(lat, lon, speedKmh) {
    // Save last received GPS coordinate and timestamp
    lastGPSLat = lat;
    lastGPSLon = lon;
    lastGPSTime = Date.now();
    if (speedKmh !== null && speedKmh !== undefined) {
        lastGPSSpeedKmh = speedKmh; // preserve actual speed (including 0)
    }

    // Reset signal check timer upon receiving fresh update
    if (deadReckonTimer) clearInterval(deadReckonTimer);
    
    // If we just recovered from a low signal state, restore UI (only if trip is active)
    if (activeTripId) {
        const statusText = document.getElementById('trip-status-text');
        if (statusText && statusText.textContent !== 'Trip active — GPS tracking live') {
            handleDriverOnline();
        }
    }
    
    // Periodically check if GPS stops updating
    deadReckonTimer = setInterval(() => {
        const elapsed = Date.now() - lastGPSTime;
        if (elapsed >= 5000) { // If no real update in 5 seconds
            const statusText = document.getElementById('trip-status-text');
            const statusBar = document.getElementById('trip-status-bar');
            if (statusText && activeTripId) {
                statusText.textContent = 'GPS Signal Low — Showing last known location';
                statusText.style.color = '#d97706'; // warning yellow/orange
                if (statusBar) {
                    statusBar.style.background = 'rgba(217, 119, 6, 0.1)';
                    statusBar.style.border = '1px solid rgba(217, 119, 6, 0.2)';
                }
                
                // Pause the timer since we aren't getting fresh updates!
                if (typeof stopTripTimer === 'function') stopTripTimer();
            }
        }
    }, 1000);

    // A. Update Speed Card
    const speedDisplay = document.getElementById('speed-display');
    if (speedDisplay && speedKmh !== null) {
        speedDisplay.textContent = Math.round(speedKmh) + ' km/h';
    }

    // B. Update Position Card (Reverse Geocoding)
    const now = Date.now();
    const locationDisplay = document.getElementById('location-display');
    if (locationDisplay) {
        let shouldGeocode = (now - lastReverseGeocodeTime > 25000);
        
        if (!shouldGeocode && lastReverseGeocodeLat !== null) {
            const distMoved = haversineDistance(lastReverseGeocodeLat, lastReverseGeocodeLon, lat, lon);
            if (distMoved > 200) shouldGeocode = true;
        }

        if (shouldGeocode || lastReverseGeocodeLat === null) {
            locationDisplay.classList.add('searching');
            geocodeIfNeeded(lat, lon).then(name => {
                locationDisplay.textContent = name;
                locationDisplay.classList.remove('searching');
                lastReverseGeocodeTime = now;
                lastReverseGeocodeLat  = lat;
                lastReverseGeocodeLon  = lon;
            });
        }
    }

    // Restore standard active tracking style if we received standard update
    const statusBar2 = document.getElementById('trip-status-bar');
    const statusText2 = document.getElementById('trip-status-text');
    const statusDot = statusBar2 ? statusBar2.querySelector('[class^="status-dot"]') : null;
    if (statusText2 && activeTripId) {
        statusText2.textContent = 'Trip active — GPS tracking live';
        statusText2.style.color = '#2A7D55';
        if (statusBar2) {
            statusBar2.style.background = '#F0FDF6';
            statusBar2.style.border = '1px solid #BBF0D6';
        }
        if (statusDot) {
            statusDot.style.background = '#2A7D55';
            statusDot.style.boxShadow = 'none';
        }
    }

    // C. Update Map Marker Smoothly
    const busLabel = busId.replace(/bus\s*/i, 'B').toUpperCase();
    if (typeof updateBusMarker === 'function') {
        updateBusMarker(lat, lon, busLabel);
    }

    // D. Road-Based ETA Engine (replaces old AIEta)
    if (typeof RoadETA !== 'undefined') {
        RoadETA.update(lat, lon, speedKmh || lastGPSSpeedKmh, studentLatGlobal, studentLonGlobal, lastGPSTime, busId, studentAccuracyGlobal)
            .catch(() => {}); // never crash the GPS loop
    }
}

async function geocodeIfNeeded(lat, lon) {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`);
        const data = await response.json();
        if (data && data.display_name) {
            return data.display_name.split(',').slice(0, 2).join(', ');
        }
    } catch (err) {}
    return `${lat.toFixed(4)}° N, ${lon.toFixed(4)}° E`;
}

// ---------------------------------------------
// Optional Student Location Sharing
// ---------------------------------------------
function checkLocationSharingPrompt() {
    if (!sessionStorage.getItem(`locationPrompted_${busId}`)) {
        const modal = document.getElementById('locationPrompt');
        if (modal) modal.classList.add('active');
    } else if (sessionStorage.getItem(`locationGranted_${busId}`) === 'true') {
        startStudentGPS();
    }
}

document.getElementById('btn-deny')?.addEventListener('click', () => {
    sessionStorage.setItem(`locationPrompted_${busId}`, 'true');
    sessionStorage.setItem(`locationGranted_${busId}`, 'false');
    document.getElementById('locationPrompt').classList.remove('active');
});

document.getElementById('btn-allow')?.addEventListener('click', () => {
    sessionStorage.setItem(`locationPrompted_${busId}`, 'true');
    sessionStorage.setItem(`locationGranted_${busId}`, 'true');
    document.getElementById('locationPrompt').classList.remove('active');
    
    startStudentGPS();
});

let studentWatchId = null;

function startStudentGPS() {
    if (navigator.geolocation) {
        studentWatchId = navigator.geolocation.watchPosition((pos) => {
            const sLat = pos.coords.latitude;
            const sLon = pos.coords.longitude;
            const accuracy = pos.coords.accuracy;

            // Store globally for use in processNewLocation
            studentLatGlobal = sLat;
            studentLonGlobal = sLon;
            studentAccuracyGlobal = accuracy;
            
            // Update student marker locally (no database upload, avoiding DB growth)
            if (typeof L !== 'undefined' && window.map) {
                if (window.userMarker) {
                    window.userMarker.setLatLng([sLat, sLon]);
                } else {
                    window.userMarker = L.circleMarker([sLat, sLon], {
                        radius: 8,
                        fillColor: '#6366f1',
                        color: '#ffffff',
                        weight: 3,
                        fillOpacity: 0.9
                    }).addTo(window.map).bindPopup('Your Location');
                }
            }
            
            // Road ETA update with student coords
            if (lastGPSLat && lastGPSLon && typeof RoadETA !== 'undefined') {
                RoadETA.update(lastGPSLat, lastGPSLon, lastGPSSpeedKmh, sLat, sLon, lastGPSTime, busId, studentAccuracyGlobal)
                    .catch(() => {});
            }
        }, (err) => {
            console.warn("Student GPS tracking error:", err);
            const etaEl = document.getElementById('road-eta-dest');
            if (etaEl && etaEl.textContent === 'Loading...') {
                // Don't change destination ETA — only affects student proximity
            }
        }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
    }
}

// ============================================================================
// FOLLOW BUS MODE - User-Controlled Map Panning
// ============================================================================

window.isFollowBusEnabled = true; // Default: automatically track bus movement on map

function toggleFollowBusMode() {
  window.isFollowBusEnabled = !window.isFollowBusEnabled;
  
  const button = document.getElementById('follow-bus-button');
  if (window.isFollowBusEnabled) {
    button.classList.add('active');
    button.textContent = '📍 Following Bus (click to explore)';
    console.log('🎯 Follow mode ON - map will track bus');
    
    // Center immediately if possible
    if (window.busMarker && window.map) {
      window.map.panTo(window.busMarker.getLatLng(), { animate: true, duration: 1 });
    }
  } else {
    button.classList.remove('active');
    button.textContent = '📍 Explore Map (click to follow)';
    console.log('🗺️ Follow mode OFF - explore freely');
  }
}
window.toggleFollowBusMode = toggleFollowBusMode;

// ============================================================================
// NEARBY ALERT FEATURE
// ============================================================================

let isNearbyAlertEnabled = false;
let alertTriggered = false;

function toggleNearbyAlert() {
  isNearbyAlertEnabled = !isNearbyAlertEnabled;
  const btn = document.getElementById('alert-nearby-btn');
  if (isNearbyAlertEnabled) {
    btn.style.background = '#059669';
    btn.style.color = 'white';
    btn.innerHTML = '<i class="fas fa-bell-slash"></i> Disable Alert';
    alertTriggered = false; // Reset trigger
    alert('You will be alerted when the bus is within 1km of your location.');
  } else {
    btn.style.background = 'rgba(255, 255, 255, 0.9)';
    btn.style.color = '#0f172a';
    btn.innerHTML = '<i class="fas fa-bell"></i> Alert when nearby';
  }
}

function checkNearbyAlert(busLat, busLon) {
  if (!isNearbyAlertEnabled || alertTriggered) return;
  if (typeof userMarker !== 'undefined' && userMarker && typeof haversineDistance === 'function') {
    const userPos = userMarker.getLatLng();
    const dist = haversineDistance(userPos.lat, userPos.lng, busLat, busLon);
    if (dist < 1000) {
      alertTriggered = true;
      alert('The bus is within 1km of your location!');
      if(window.Notification && window.Notification.permission === 'granted') {
        new window.Notification('Bus Approaching', { body: 'The bus is within 1km of your location!' });
      } else if (window.Notification && window.Notification.permission !== 'denied') {
        window.Notification.requestPermission().then(perm => {
          if(perm === 'granted') {
            new window.Notification('Bus Approaching', { body: 'The bus is within 1km of your location!' });
          }
        });
      }
    }
  }
}
