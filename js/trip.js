let watchId = null;
let currentStopIndex = 0;
let lastLat, lastLon, lastTime;
let lastSavedLat  = null;
let lastSavedLon  = null;
let lastSavedTime = 0;
let lastComputedLat = null;
let lastComputedLon = null;
let lastSpeedKmh = 0;
let tripStartTime = null;
let activeTripId = null;
let currentTripType = null;
let lastReverseGeocodeTime = 0;
let lastReverseGeocodeLat = null;
let lastReverseGeocodeLon = null;
let driverKalman = null;

// Screen Wake Lock API
let wakeLock = null;

async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log('Screen Wake Lock is active. Phone will not sleep.');
        }
    } catch (err) {
        console.error('Wake Lock failed:', err);
    }
}

function releaseWakeLock() {
    if (wakeLock !== null) {
        wakeLock.release().then(() => {
            wakeLock = null;
            console.log('Screen Wake Lock released.');
        });
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && activeTripId) {
        requestWakeLock();
    }
});

// Caching and validation states
const geocodeCache = new Map();
let stopConfirmationStart = null;
let stopConfirmationIndex = null;
const alreadyMarked = new Set();
let lastRawLat = null;
let lastRawLon = null;
let lastRawTime = 0;
let lastProcessedLat = null;
let lastProcessedLon = null;
let lastProcessedTime = 0;

const MIN_DISTANCE_METERS = 1;
const MAX_SAVE_INTERVAL_MS = 2500;
const MIN_COMPUTED_MOVEMENT = 1; // meters

async function startTrip() {
    const driver = JSON.parse(localStorage.getItem('driverSession'));
    let busId = driver.assignedBus || driver.busId;
    
    const tripSelect = document.getElementById('trip-select');
    const tripType = tripSelect ? tripSelect.value : 'morning';
    const btn = document.getElementById('start-btn');

    if (!busId) { alert('No bus assigned to this driver.'); return; }

    if (typeof showCachedLocationIfAvailable === 'function') {
        showCachedLocationIfAvailable();
    }

    // Visual feedback for 'lag'
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Starting...';

    const token = JSON.parse(localStorage.getItem('driverSession'))?.token;
    const res = await fetch(`${BACKEND_URL}/api/trip/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ bus_id: busId, trip_type: tripType })
    });
    
    if (!res.ok) {
        const errData = await res.json();
        console.error("Start trip error:", errData.error);
        alert("Failed to start trip: " + (errData.error || "Unknown error"));
        btn.textContent = originalText;
        btn.disabled = false;
        return;
    }
    const { trip } = await res.json();

    localStorage.setItem('activeTripId', trip.id);
    localStorage.setItem('activeBusId', busId);
    localStorage.setItem('activeTripType', tripType);

    activeTripId = trip.id;
    currentTripType = tripType;

    // Get Auth Token for backend API
    const userEmail = driver.email || 'driver@providence.edu.in';
    await getAuthToken(driver.driverId, userEmail, 'driver', trip.id);

    startDriverGPS(trip.id, busId, tripType);
    startTripTimer();
    requestWakeLock(); // Request wake lock to keep screen on

    btn.disabled = false; // re-enable for End Trip
    btn.textContent = 'End Trip';
    btn.style.background = '#DC2626';
    btn.onclick = endTrip;
}

// UPDATE 4 — Safe Speed Calculation
function calculateSafeSpeed(lat1, lon1, lat2, lon2, timeDiffMs) {
    if (timeDiffMs < 1000) return null;           // skip if under 1 second
    const dist     = haversineDistance(lat1, lon1, lat2, lon2);
    const speedKmh = (dist / (timeDiffMs / 1000)) * 3.6;
    if (speedKmh > 120) return null;              // discard unrealistic value
    return parseFloat(speedKmh.toFixed(1));
}

function roundCoord(value) {
    return Math.round(value * 1000000) / 1000000; // 6 decimal places (~11cm accuracy)
}

// UPDATE 14 — Database Load Control
function shouldSaveLocation(lat, lon) {
    const now      = Date.now();
    const timeDiff = now - lastSavedTime;

    if (timeDiff >= MAX_SAVE_INTERVAL_MS) return true; // 10 seconds passed

    if (lastSavedLat !== null) {
        const dist = haversineDistance(lastSavedLat, lastSavedLon, lat, lon);
        if (dist >= MIN_DISTANCE_METERS) return true;    // moved more than 5m
    }

    return lastSavedLat === null;
}

// OPTIMIZATION 9 — Non-blocking Background Saves
function saveLocationBackground(tripId, busId, lat, lon, speed) {
    const driver = JSON.parse(localStorage.getItem('driverSession'));
    const driverId = driver ? driver.driverId : 'unknown';
    
    submitLocationSecure(lat, lon, speed, tripId, busId, 'driver', driverId)
      .then(result => {
          if (!result.success) console.warn('Location submission failed:', result.error);
      })
      .catch(err => console.error('Save error:', err));
}


let lastComputedTime = 0;

// UPDATE 18 — Realtime Update Optimization
async function saveComputedLocationIfChanged(tripId, busId, lat, lon, speedKmh) {
    const roundedLat = parseFloat(lat.toFixed(6));
    const roundedLon = parseFloat(lon.toFixed(6));
    const now = Date.now();

    // STRICT RATE LIMIT: Only send to server exactly every 3 seconds
    if (lastComputedLat !== null) {
        if (now - lastComputedTime < 3000) return; 
    }

    // Handled by backend UPSERT to current_bus_locations now
    // We can just rely on saveLocationBackground if we merge them, but we'll keep this separate if needed
    // Actually, we'll let saveLocationBackground handle the UPSERT to current_bus_locations via backend
    lastComputedLat = roundedLat;
    lastComputedLon = roundedLon;
    lastComputedTime = now;
}

// UPDATE 15 — Stop Arrival Duplicate Protection
async function recordStopArrival(tripId, stopName, stopIndex) {
    const token = JSON.parse(localStorage.getItem('driverSession'))?.token;
    const res = await fetch(`${BACKEND_URL}/api/trip/stop-arrival`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ trip_id: tripId, stop_name: stopName, stop_index: stopIndex })
    });
    if (!res.ok) {
        console.error("Error recording stop arrival");
    }
}

// UPDATE 19 — Student-Assisted Location Improvement (The Core Hub)
async function processNewDriverLocation(tripId, busId, smoothedLat, smoothedLon) {
    const roundedLat = roundCoord(smoothedLat);
    const roundedLon = roundCoord(smoothedLon);

    // 1. Save driver location — following load control
    if (shouldSaveLocation(roundedLat, roundedLon)) {
        saveLocationBackground(tripId, busId, roundedLat, roundedLon, lastSpeedKmh);
        lastSavedLat = roundedLat;
        lastSavedLon = roundedLon;
        lastSavedTime = Date.now();
    }

    // 2. Use Driver Location Only (Bypass student averaging)
    saveComputedLocationIfChanged(tripId, busId, roundedLat, roundedLon, lastSpeedKmh);
}

// NEW — Reverse Geocoding with Caching and Formatting
async function getPlaceName(lat, lon) {
    const key = roundCoord(lat) + "," + roundCoord(lon);
    if (geocodeCache.has(key)) {
        return geocodeCache.get(key);
    }

    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`
        );
        const data = await response.json();
        const name = data.display_name || 'Unknown location';
        geocodeCache.set(key, name);
        return name;
    } catch (error) {
        console.error("Reverse geocoding failed:", error);
        return 'Unknown location';
    }
}

async function geocodeIfNeeded(lat, lon) {
    const name = await getPlaceName(lat, lon);
    return name;
}

function getDynamicInterval(speedKmh) {
    if (speedKmh > 20) return 1000;  // fast — send every 1s
    return 2000;                      // slow or stopped — send every 2s
}

function isValidGPSReading(lat1, lon1, lat2, lon2, timeDiffSec) {
    if (timeDiffSec <= 0) return false;
    const dist = haversineDistance(lat1, lon1, lat2, lon2);
    const speedMps = dist / timeDiffSec;
    return speedMps <= 100; // max 100 meters per second allowed
}

function shouldProcessUpdate(lat1, lon1, lat2, lon2, timeDiffSec) {
    const MIN_MOVEMENT_METERS = 20;
    const MAX_TIME_WITHOUT_UPDATE_SEC = 10;
    
    if (timeDiffSec >= MAX_TIME_WITHOUT_UPDATE_SEC) return true;
    
    const dist = haversineDistance(lat1, lon1, lat2, lon2);
    return dist >= MIN_MOVEMENT_METERS;
}

// UPDATE 1 — startDriverTracking renamed to startDriverGPS
function startDriverGPS(tripId, busId, tripType) {
    const busLabel = busId.toLowerCase().includes('bus') ? 
                     busId.replace(/bus\s*/i, 'B').toUpperCase() : busId;

    if (window.KalmanFilter) {
        driverKalman = new window.KalmanFilter();
    }

    // Aggressively grab ANY cached location instantly to prevent the 30-second blank map
    navigator.geolocation.getCurrentPosition((pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        if (typeof cacheCurrentLocation === 'function') {
            cacheCurrentLocation(lat, lon, pos.coords.accuracy);
        }
        updateBusMarker(lat, lon, busLabel);
    }, () => {}, { maximumAge: Infinity, timeout: 3000 });

    watchId = navigator.geolocation.watchPosition(async (pos) => {
        const now = Date.now();
        
        let lat = pos.coords.latitude;
        let lon = pos.coords.longitude;
        const accuracy = pos.coords.accuracy;

        // ==========================================
        // GPS SPIKE FILTERING (100m+ Jump Protection)
        // ==========================================
        
        // 1. Hardware Accuracy Check: Relaxed for testing (allows desktop IP location up to 20000m)
        if (accuracy >= 20000) {
            console.warn(`[GPS Filter] Discarding ping: Accuracy too low (${Math.round(accuracy)}m)`);
            return;
        }

        // 2. Teleportation Check: Discard if the bus supposedly jumped an impossible distance instantly
        if (lastLat && lastLon && lastTime) {
            const timeDiffSec = (now - lastTime) / 1000;
            if (timeDiffSec > 0) {
                const distMoved = haversineDistance(lastLat, lastLon, lat, lon); // distance in meters
                const speedMps = distMoved / timeDiffSec;
                
                // If the bus supposedly moved faster than 120km/h (~33 meters/second), it's a GPS glitch.
                // We discard this ping to prevent the marker from jumping 100m+ away.
                if (speedMps > 35) {
                    console.warn(`[GPS Filter] Discarding glitch jump: ${Math.round(distMoved)}m in ${Math.round(timeDiffSec)}s`);
                    return;
                }
            }
        }

        // Run through Kalman Filter for mathematical smoothing
        if (driverKalman) {
            const smoothed = driverKalman.process(lat, lon, accuracy, now);
            lat = smoothed.lat;
            lon = smoothed.lon;
        }

        if (typeof cacheCurrentLocation === 'function') {
            cacheCurrentLocation(lat, lon, accuracy);
        }

        // UPDATE 4 — Safe Speed Calculation
        if (lastLat && lastLon) {
            const speed = calculateSafeSpeed(lastLat, lastLon, lat, lon, now - lastTime);
            if (speed !== null) lastSpeedKmh = speed;
        }
        
        lastLat = lat; 
        lastLon = lon; 
        lastTime = now;

        // UI Updates for Driver
        const speedDisplay = document.getElementById('speed-display');
        if (speedDisplay) speedDisplay.textContent = lastSpeedKmh + ' km/h';

        const locationDisplay = document.getElementById('location-display');
        if (locationDisplay) {
            let shouldGeocode = (now - lastReverseGeocodeTime > 25000);
            if (!shouldGeocode && lastReverseGeocodeLat !== null) {
                const distMoved = haversineDistance(lastReverseGeocodeLat, lastReverseGeocodeLon, lat, lon);
                if (distMoved > 200) shouldGeocode = true;
            }

            if (shouldGeocode || lastReverseGeocodeLat === null) {
                geocodeIfNeeded(lat, lon).then(name => {
                    locationDisplay.textContent = name;
                    lastReverseGeocodeTime = now;
                    lastReverseGeocodeLat  = lat;
                    lastReverseGeocodeLon  = lon;
                });
            }
        }

        updateBusMarker(lat, lon, busLabel);

        processNewDriverLocation(tripId, busId, lat, lon);
        checkStopArrivalDualRadius(lat, lon, tripType, tripId);

    }, (err) => {
        console.error("GPS Watch Error:", err);
    }, { enableHighAccuracy: true, maximumAge: 60000, timeout: 15000 });
}

function advanceStopIndex(newIndex, tripId) {
    if (newIndex > currentStopIndex) {
        currentStopIndex = newIndex;
        // Point 8 — Forward only stop progression — stop index must never decrease
        const token = JSON.parse(localStorage.getItem('driverSession'))?.token;
        fetch(`${BACKEND_URL}/api/trip/stop-index`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ trip_id: tripId, stop_index: currentStopIndex })
        }).then(async res => {
            if (!res.ok) console.error("Error updating stop index in DB:", await res.text());
        });
    }
}

async function checkStopArrivalDualRadius(lat, lon, tripType, tripId) {
    const route = getRoute(tripType);
    if (currentStopIndex >= route.length) return;

    const next = route[currentStopIndex];
    const dist = haversineDistance(lat, lon, next.lat, next.lon);
    const nextStopDisplay = document.getElementById('next-stop-display');

    const REACHED_RADIUS = 60;
    const APPROACHING_RADIUS = 100;
    const CONFIRM_DURATION = 7000;

    if (dist <= REACHED_RADIUS) {
        if (stopConfirmationIndex !== currentStopIndex) {
            stopConfirmationIndex = currentStopIndex;
            stopConfirmationStart = Date.now();
        } else if (Date.now() - stopConfirmationStart >= CONFIRM_DURATION) {
            const stopKey = `${tripId}-${currentStopIndex}`;
            if (!alreadyMarked.has(stopKey)) {
                alreadyMarked.add(stopKey);
                recordStopArrival(tripId, next.name, currentStopIndex);
                
                route[currentStopIndex].arrivedAt = new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
                if (typeof markStopVisited === 'function') markStopVisited(currentStopIndex);
                
                advanceStopIndex(currentStopIndex + 1, tripId);
            }

            stopConfirmationIndex = null;
            stopConfirmationStart = null;

            if (nextStopDisplay) {
                nextStopDisplay.textContent = currentStopIndex < route.length ? route[currentStopIndex].name : 'Arrived';
            }
        }
    } else {
        if (stopConfirmationIndex === currentStopIndex) {
            stopConfirmationIndex = null;
            stopConfirmationStart = null;
        }

        if (dist <= APPROACHING_RADIUS) {
            if (nextStopDisplay) {
                nextStopDisplay.textContent = 'Approaching ' + next.name;
            }
        } else {
            if (nextStopDisplay) {
                nextStopDisplay.textContent = next.name;
            }
        }
    }
}

// UPDATE 1 — clearWatch replaced with clearTimeout
async function endTrip() {
    const tripId = localStorage.getItem('activeTripId');
    const btn = document.getElementById('start-btn');
    if (!tripId) return;

    // Visual feedback
    btn.disabled = true;
    btn.textContent = 'Ending...';

    const token = JSON.parse(localStorage.getItem('driverSession'))?.token;
    try {
        const res = await fetch(`${BACKEND_URL}/api/trip/end`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ trip_id: tripId })
        });
        
        if (!res.ok) {
            const errData = await res.json();
            console.error("End trip error:", errData.error);
            alert("Failed to end trip: " + (errData.error || "Unknown error"));
            btn.textContent = 'End Trip';
            btn.disabled = false;
            return;
        }
    } catch (err) {
        console.error("Network error ending trip:", err);
        alert("Failed to end trip due to network error.");
        btn.textContent = 'End Trip';
        btn.disabled = false;
        return;
    }

    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    
    stopTripTimer();

    localStorage.removeItem('activeTripId');
    localStorage.removeItem('activeBusId');
    localStorage.removeItem('activeTripType');
    // DO NOT clear bustrack_last_location, so the map can instantly show a marker on next start

    releaseWakeLock(); // Release wake lock
    location.reload();
}

// UPDATE 13 — Trip Recovery After Page Refresh
async function recoverActiveTrip() {
    const session = JSON.parse(localStorage.getItem('driverSession'));
    if (!session) return;

    const { data: tripsRes } = await supabase
        .from('trips')
        .select('id, bus_id, trip_type, started_at, current_stop_index')
        .eq('driver_id', session.driverId)
        .eq('status', 'active')
        .order('started_at', { ascending: false })
        .limit(1);

    const trip = tripsRes && tripsRes.length > 0 ? tripsRes[0] : null;

    if (!trip) return; // No active trip to recover

    localStorage.setItem('activeTripId', trip.id);
    localStorage.setItem('activeBusId',  trip.bus_id);
    localStorage.setItem('activeTripType', trip.trip_type);

    activeTripId       = trip.id;
    currentTripType    = trip.trip_type;
    
    // Point 8 — Forward only stop progression — stop index must never decrease
    const recoveredIndex = trip.current_stop_index || 0;
    if (recoveredIndex > currentStopIndex) {
        currentStopIndex = recoveredIndex;
    }

    // Restore timer from actual start time
    if (trip.started_at) {
        const startedAt  = new Date(trip.started_at).getTime();
        tripStartTime    = startedAt;
        // timer.js should handle tripStartTime if it's external or uses global
        startTripTimer(startedAt); 
    }

    // Resume GPS
    // Get Auth Token for backend API
    const userEmail = session.email || 'driver@providence.edu.in';
    await getAuthToken(session.driverId, userEmail, 'driver', trip.id);

    startDriverGPS(trip.id, trip.bus_id, trip.trip_type);
    requestWakeLock(); // Re-acquire wake lock on recovery

    // Update UI
    const btn = document.getElementById('start-btn');
    if (btn) {
        btn.textContent  = 'End Trip';
        btn.style.background = '#DC2626';
        btn.onclick      = endTrip;
    }

    const nextStopDisplay = document.getElementById('next-stop-display');
    if (nextStopDisplay) {
        const route = getRoute(trip.trip_type);
        nextStopDisplay.textContent = currentStopIndex < route.length ? route[currentStopIndex].name : 'Arrived';
    }
}

window.startTrip = startTrip;
window.endTrip = endTrip;
window.recoverActiveTrip = recoverActiveTrip;

// --- V3 SOS FUNCTIONALITY ---
window.triggerSOS = async function() {
    const driver = JSON.parse(localStorage.getItem('driverSession'));
    if (!driver) return;
    
    let busId = driver.assignedBus || driver.busId;
    if (!busId) { alert("No bus assigned!"); return; }

    const btn = document.getElementById('sos-btn');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> SENDING...';
    btn.disabled = true;

    try {
        const token = JSON.parse(localStorage.getItem('driverSession'))?.token;
        const res = await fetch(`${BACKEND_URL}/api/trip/sos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ bus_id: busId, latitude: lastLat || null, longitude: lastLon || null })
        });
        if (!res.ok) throw new Error("Failed to send SOS via backend");

        btn.innerHTML = '<i class="fas fa-check"></i> SOS SENT!';
        btn.style.background = '#991b1b'; // Darker red to indicate it is active
        alert("EMERGENCY SOS SENT TO ADMIN!");
    } catch (err) {
        console.error(err);
        alert("Failed to send SOS! " + err.message);
        btn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> SOS EMERGENCY';
        btn.disabled = false;
    }
};
