// js/student-console.js

let activeTripId = null;
let currentTripType = null;
let busId = null;

let lastReverseGeocodeTime = 0;
let lastReverseGeocodeLat = null;
let lastReverseGeocodeLon = null;

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Get Bus ID from URL
    const params = new URLSearchParams(window.location.search);
    const busParam = params.get('bus'); // e.g. "Bus4"
    if (!busParam) {
        window.location.href = 'student-dashboard.html';
        return;
    }
    busId = busParam.replace(/Bus/i, 'Bus '); // "Bus4" -> "Bus 4"

    // 2. Fetch Active Trip and Initial Location in parallel
    const trip = await getTripInfo(busId);
    const locData = await getBusLocation(busId);
    
    const locRes = { data: locData ? [locData] : null };

    if (!trip) {
        document.getElementById('location-display').textContent = 'No trip history found for ' + busId;
        return;
    }

    activeTripId = trip.id;
    currentTripType = trip.trip_type;
    const isTripActive = trip.status === 'active';

    // 3. Fetch Driver Details
    let driverName = 'Unknown Driver';
    const { data: session } = await supabase.from('driver_sessions').select('driver_name, is_online').eq('bus_id', busId).single();
    if (session && session.driver_name) {
        driverName = session.driver_name;
    } else {
        const { data: busData } = await supabase.from('buses').select('driver_name').eq('id', busId).single();
        if (busData && busData.driver_name) driverName = busData.driver_name;
    }

    document.getElementById('driver-name-display').textContent = driverName;
    document.getElementById('assigned-bus-label').textContent = busId;

    if (session && session.is_online === false) {
        handleDriverOffline();
    } else if (!isTripActive) {
        handleTripEnded();
    }

    // 4. Initialize Map and Timer
    initMap(currentTripType);
    
    const statusBar = document.getElementById('trip-status-bar');
    
    if (isTripActive && (!session || session.is_online !== false)) {
        if (statusBar) statusBar.classList.add('visible');
    }
    
    if (isTripActive && trip.started_at && (!session || session.is_online !== false)) {
        const startedAt = new Date(trip.started_at).getTime();
        startTripTimer(startedAt);
    }

    // 5. Display Initial Location Immediately
    if (locRes.data && locRes.data.length > 0) {
        processNewLocation(locRes.data[0].latitude, locRes.data[0].longitude, locRes.data[0].speed_kmh);
    }

    // 6. Subscribe to Realtime Updates
    subscribeToLiveUpdates();

    // 7. Prompt for Location Access (Optional)
    if (isTripActive) {
        checkLocationSharingPrompt();
    }
});

function subscribeToLiveUpdates() {
    supabase.channel(`bus-${busId}-live`)
        .on('postgres_changes', {
            event: '*', // Listen to INSERT and UPDATE since we are using UPSERT
            schema: 'public',
            table: 'current_bus_locations',
            filter: `bus_id=eq.${busId}`
        }, (payload) => {
            if (payload.new.trip_id === activeTripId) {
                processNewLocation(payload.new.latitude, payload.new.longitude, payload.new.speed_kmh);
            }
        })
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'driver_sessions',
            filter: `bus_id=eq.${busId}`
        }, (payload) => {
            if (payload.new.is_online === false) {
                handleDriverOffline();
            } else if (payload.new.is_online === true) {
                handleDriverOnline();
            }
        })
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'trips',
            filter: `id=eq.${activeTripId}`
        }, (payload) => {
            if (payload.new.status === 'completed' || payload.new.status === 'cancelled') {
                handleTripEnded();
            }
        })
        .subscribe();

    // Fallback: Check driver heartbeat every 30 seconds in case they forcefully closed the app
    // and the database wasn't updated via Realtime
    setInterval(async () => {
        const { data: session } = await supabase.from('driver_sessions')
            .select('last_seen, is_online')
            .eq('bus_id', busId)
            .single();
            
        if (session) {
            if (session.is_online === false) {
                handleDriverOffline();
            } else if (session.last_seen) {
                const timeDiffMs = new Date() - new Date(session.last_seen);
                if (timeDiffMs > 90000) { // 90 seconds timeout
                    handleDriverOffline();
                } else if (activeTripId) {
                    // Only restore green status if heartbeat is fresh AND they haven't explicitly ended trip
                    handleDriverOnline();
                }
            }
        }
    }, 30000);
}

function handleDriverOffline() {
    const statusBar = document.getElementById('trip-status-bar');
    const statusText = document.getElementById('trip-status-text');
    const statusDot = statusBar ? statusBar.querySelector('[class^="status-dot"]') : null;
    
    if (statusBar && statusText) {
        statusBar.classList.add('visible'); // MAKE VISIBLE
        statusBar.style.background = 'rgba(239, 68, 68, 0.1)';
        statusBar.style.border = '1px solid rgba(239, 68, 68, 0.2)';
        statusText.textContent = 'Driver Offline — Showing last known location';
        statusText.style.color = '#ef4444';
        if (statusDot) {
            statusDot.style.background = '#ef4444';
            statusDot.style.boxShadow = '0 0 8px #ef4444';
        }
    }
    const speedDisplay = document.getElementById('speed-display');
    if (speedDisplay) speedDisplay.textContent = '0 km/h';
    if (typeof stopTripTimer === 'function') stopTripTimer();
}

function handleTripEnded() {
    const statusBar = document.getElementById('trip-status-bar');
    const statusText = document.getElementById('trip-status-text');
    const statusDot = statusBar ? statusBar.querySelector('[class^="status-dot"]') : null;
    
    if (statusBar && statusText) {
        statusBar.classList.add('visible'); // MAKE VISIBLE
        statusBar.style.background = 'rgba(245, 158, 11, 0.1)';
        statusBar.style.border = '1px solid rgba(245, 158, 11, 0.2)';
        statusText.textContent = 'Trip Ended — Showing last known location';
        statusText.style.color = '#f59e0b';
        if (statusDot) {
            statusDot.style.background = '#f59e0b';
            statusDot.style.boxShadow = '0 0 8px #f59e0b';
        }
    }
    const speedDisplay = document.getElementById('speed-display');
    if (speedDisplay) speedDisplay.textContent = '0 km/h';
    if (typeof stopTripTimer === 'function') stopTripTimer();
}

function handleDriverOnline() {
    const statusBar = document.getElementById('trip-status-bar');
    const statusText = document.getElementById('trip-status-text');
    const statusDot = statusBar ? statusBar.querySelector('[class^="status-dot"]') : null;
    
    // Only restore green status if the trip hasn't ended.
    if (activeTripId) {
        supabase.from('trips').select('status').eq('id', activeTripId).single().then(({data}) => {
            if (data && data.status === 'active' && statusBar && statusText) {
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
        });
    }
}

function processNewLocation(lat, lon, speedKmh) {
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

    // C. Update Map Marker Smoothly
    const busLabel = busId.replace(/bus\s*/i, 'B').toUpperCase();
    if (typeof updateBusMarker === 'function') {
        updateBusMarker(lat, lon, busLabel);
    }
}

async function geocodeIfNeeded(lat, lon) {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`);
        const data = await response.json();
        return data.display_name.split(',').slice(0, 2).join(', ');
    } catch (err) {
        return 'Location unknown';
    }
}

// ---------------------------------------------
// Optional Student Location Sharing (DISABLED)
// ---------------------------------------------
function checkLocationSharingPrompt() {
    // Passenger GPS uploads have been disabled completely to reduce database load.
    console.log("Passenger GPS uploads disabled.");
}

document.getElementById('btn-deny')?.addEventListener('click', () => {
    sessionStorage.setItem(`locationPrompted_${busId}`, 'true');
    document.getElementById('locationPrompt').classList.remove('active');
});

document.getElementById('btn-allow')?.addEventListener('click', () => {
    sessionStorage.setItem(`locationPrompted_${busId}`, 'true');
    document.getElementById('locationPrompt').classList.remove('active');
    
    // GPS start disabled.
});

// ============================================================================
// FOLLOW BUS MODE - User-Controlled Map Panning
// ============================================================================

window.isFollowBusEnabled = false; // Default: user can explore map freely

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

