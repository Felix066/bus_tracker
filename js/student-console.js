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

    // 2. Fetch Active Trip for this Bus
    const { data: trip } = await supabase
        .from('trips')
        .select('id, driver_id, trip_type, started_at, current_stop_index')
        .eq('bus_id', busId)
        .eq('status', 'active')
        .single();

    if (!trip) {
        document.getElementById('location-display').textContent = 'No active trip for ' + busId;
        return;
    }

    activeTripId = trip.id;
    currentTripType = trip.trip_type;

    // 3. Fetch Driver Details
    const { data: driver } = await supabase
        .from('drivers')
        .select('username')
        .eq('id', trip.driver_id)
        .single();

    document.getElementById('driver-name-display').textContent = driver ? driver.username : 'Unknown Driver';
    document.getElementById('assigned-bus-label').textContent = busId;

    // 4. Initialize Map and Timer
    initMap(currentTripType);
    
    if (trip.started_at) {
        const startedAt = new Date(trip.started_at).getTime();
        startTripTimer(startedAt);
    }

    // 5. Fetch Initial Location Immediately
    fetchInitialLocation();

    // 6. Subscribe to Realtime Updates
    subscribeToLiveUpdates();

    // 7. Prompt for Location Access (Optional)
    checkLocationSharingPrompt();
});

async function fetchInitialLocation() {
    const { data, error } = await supabase
        .from('computed_locations')
        .select('latitude, longitude, speed_kmh')
        .eq('bus_id', busId)
        .order('computed_at', { ascending: false })
        .limit(1);
    
    if (data && data.length > 0) {
        processNewLocation(data[0].latitude, data[0].longitude, data[0].speed_kmh);
    }
}

function subscribeToLiveUpdates() {
    supabase.channel(`bus-${busId}-live`)
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'computed_locations',
            filter: `bus_id=eq.${busId}`
        }, (payload) => {
            if (payload.new.trip_id === activeTripId) {
                processNewLocation(payload.new.latitude, payload.new.longitude, payload.new.speed_kmh);
            }
        })
        .subscribe();
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
// Optional Student Location Sharing
// ---------------------------------------------
function checkLocationSharingPrompt() {
    const hasPrompted = sessionStorage.getItem(`locationPrompted_${busId}`);
    if (!hasPrompted) {
        setTimeout(() => {
            const modal = document.getElementById('locationPrompt');
            if (modal) modal.classList.add('active');
        }, 2000); // 2 second delay before asking
    }
}

document.getElementById('btn-deny')?.addEventListener('click', () => {
    sessionStorage.setItem(`locationPrompted_${busId}`, 'true');
    document.getElementById('locationPrompt').classList.remove('active');
});

document.getElementById('btn-allow')?.addEventListener('click', () => {
    sessionStorage.setItem(`locationPrompted_${busId}`, 'true');
    document.getElementById('locationPrompt').classList.remove('active');
    
    const session = JSON.parse(localStorage.getItem('userSession'));
    const userRole = session ? session.role : 'student';

    // Call existing gps.js function
    if (window.startPassengerGPS) {
        localStorage.setItem('activeTripId', activeTripId);
        window.startPassengerGPS(activeTripId, busId, userRole);
    }
});
