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
    const tripType = tripSelect.value;
    const btn = document.getElementById('start-btn');

    if (!busId) { alert('No bus assigned to this driver.'); return; }

    if (typeof showCachedLocationIfAvailable === 'function') {
        showCachedLocationIfAvailable();
    }

    // Visual feedback for 'lag'
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Starting...';

    const { data: trip, error } = await supabase.from('trips').insert({
        bus_id: busId,
        driver_id: driver.driverId,
        trip_type: tripType,
        status: 'active',
        started_at: new Date().toISOString()
    }).select().single();

    if (error) { 
        console.error(error); 
        return; 
    }

    localStorage.setItem('activeTripId', trip.id);
    localStorage.setItem('activeBusId', busId);
    localStorage.setItem('activeTripType', tripType);

    activeTripId = trip.id;
    currentTripType = tripType;

    startDriverGPS(trip.id, busId, tripType);
    startTripTimer();

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
    supabase.from('bus_locations').insert({
        trip_id: tripId, bus_id: busId,
        source_role: 'driver',
        latitude: lat, longitude: lon,
        speed_kmh: speed,
        is_accepted: true
    }).then(() => {}).catch(err => console.error('Save error:', err));
}


// UPDATE 18 — Realtime Update Optimization
async function saveComputedLocationIfChanged(tripId, busId, lat, lon, speedKmh) {
    const roundedLat = parseFloat(lat.toFixed(6));
    const roundedLon = parseFloat(lon.toFixed(6));

    if (lastComputedLat !== null) {
        const dist = haversineDistance(lastComputedLat, lastComputedLon, roundedLat, roundedLon);
        if (dist < MIN_COMPUTED_MOVEMENT) return; // skip — not moved enough
    }

    supabase.from('computed_locations').insert({
        trip_id:   tripId,
        bus_id:    busId,
        latitude:  roundedLat,
        longitude: roundedLon,
        speed_kmh: speedKmh
    }).then(({ error }) => {
        if (error) console.error("Error saving computed location:", error);
    });

    lastComputedLat = roundedLat;
    lastComputedLon = roundedLon;
}

// UPDATE 15 — Stop Arrival Duplicate Protection
async function recordStopArrival(tripId, stopName, stopIndex) {
    const { data: existing } = await supabase
        .from('stop_arrivals')
        .select('id')
        .eq('trip_id', tripId)
        .eq('stop_index', stopIndex)
        .single();

    if (existing) {
        console.log('Stop already recorded — skipping duplicate:', stopName);
        return;
    }

    supabase.from('stop_arrivals').insert({
        trip_id:    tripId,
        stop_name:  stopName,
        stop_index: stopIndex
    }).then(({ error }) => {
        if (error) console.error("Error recording stop arrival:", error);
    });
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
    const kalman = new KalmanFilter();
    const busLabel = busId.toLowerCase().includes('bus') ? 
                     busId.replace(/bus\s*/i, 'B').toUpperCase() : busId;

    watchId = navigator.geolocation.watchPosition(async (pos) => {
        const now = Date.now();

        const smoothed = kalman.process(
            pos.coords.latitude, pos.coords.longitude,
            pos.coords.accuracy, pos.timestamp
        );

        if (typeof cacheCurrentLocation === 'function') {
            cacheCurrentLocation(smoothed.lat, smoothed.lon, pos.coords.accuracy);
        }

        // UPDATE 4 — Safe Speed Calculation
        if (lastLat && lastLon) {
            const speed = calculateSafeSpeed(lastLat, lastLon, smoothed.lat, smoothed.lon, now - lastTime);
            if (speed !== null) lastSpeedKmh = speed;
        }
        
        lastLat = smoothed.lat; 
        lastLon = smoothed.lon; 
        lastTime = now;

        // UI Updates for Driver
        const speedDisplay = document.getElementById('speed-display');
        if (speedDisplay) speedDisplay.textContent = lastSpeedKmh + ' km/h';

        const locationDisplay = document.getElementById('location-display');
        if (locationDisplay) {
            let shouldGeocode = (now - lastReverseGeocodeTime > 25000);
            if (!shouldGeocode && lastReverseGeocodeLat !== null) {
                const distMoved = haversineDistance(lastReverseGeocodeLat, lastReverseGeocodeLon, smoothed.lat, smoothed.lon);
                if (distMoved > 200) shouldGeocode = true;
            }

            if (shouldGeocode || lastReverseGeocodeLat === null) {
                geocodeIfNeeded(smoothed.lat, smoothed.lon).then(name => {
                    locationDisplay.textContent = name;
                    lastReverseGeocodeTime = now;
                    lastReverseGeocodeLat  = smoothed.lat;
                    lastReverseGeocodeLon  = smoothed.lon;
                });
            }
        }

        updateBusMarker(smoothed.lat, smoothed.lon, busLabel);

        processNewDriverLocation(tripId, busId, smoothed.lat, smoothed.lon);
        checkStopArrivalDualRadius(smoothed.lat, smoothed.lon, tripType, tripId);

    }, (err) => {
        console.error(err);
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 });
}

function advanceStopIndex(newIndex, tripId) {
    if (newIndex > currentStopIndex) {
        currentStopIndex = newIndex;
        // Point 8 — Forward only stop progression — stop index must never decrease
        supabase.from('trips')
            .update({ current_stop_index: currentStopIndex })
            .eq('id', tripId)
            .then(({ error }) => {
                if (error) console.error("Error updating stop index in DB:", error);
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

    await supabase.from('trips')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', tripId);

    if (watchId !== null) {
        clearTimeout(watchId);
        watchId = null;
    }
    
    stopTripTimer();

    localStorage.removeItem('activeTripId');
    localStorage.removeItem('activeBusId');
    localStorage.removeItem('activeTripType');
    localStorage.removeItem('bustrack_last_location'); // Clear map marker on end trip

    location.reload();
}

// UPDATE 13 — Trip Recovery After Page Refresh
async function recoverActiveTrip() {
    const session = JSON.parse(localStorage.getItem('driverSession'));
    if (!session) return;

    const { data: trip } = await supabase
        .from('trips')
        .select('id, bus_id, trip_type, started_at, current_stop_index')
        .eq('driver_id', session.driverId)
        .eq('status', 'active')
        .single();

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
    startDriverGPS(trip.id, trip.bus_id, trip.trip_type);

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

