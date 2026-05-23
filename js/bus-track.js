document.addEventListener('DOMContentLoaded', async () => {
  const session = JSON.parse(localStorage.getItem('userSession'));
  if (!session) {
    window.location.href = 'index.html';
    return;
  }

  // UI Elements
  const offlineBanner = document.getElementById('offline-banner');
  const navTitle = document.getElementById('nav-title');
  const speedEl = document.getElementById('bus-speed');
  const positionEl = document.getElementById('bus-position');
  const contributorsEl = document.getElementById('contributors-count');
  const locationPopup = document.getElementById('location-popup');
  const btnShare = document.getElementById('btn-share-loc');
  const btnNotNow = document.getElementById('btn-not-now');

  let activeTrip = null;
  let map = null;
  let busMarker = null;
  let stopMarkers = [];
  let routePolyline = null;
  let routeData = [];

  // 1. Initialize Map
  function initMap() {
    // Default center to Pandalam approximately
    map = L.map('map').setView([9.2375, 76.6810], 11);
    
    // Premium map tiles (CartoDB Positron for clean look)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 19
    }).addTo(map);
  }

  initMap();

  // 2. Fetch Active Trip
  async function fetchActiveTrip() {
    try {
      const { data, error } = await supabase
        .from('trips')
        .select('*')
        .eq('bus_id', 'Bus 4')
        .eq('status', 'active')
        .order('started_at', { ascending: false })
        .limit(1);
      
      if (error) throw error;
      
      if (data && data.length > 0) {
        activeTrip = data[0];
        navTitle.textContent = `Bus 4 - ${activeTrip.trip_type.charAt(0).toUpperCase() + activeTrip.trip_type.slice(1)} Trip`;
        offlineBanner.classList.remove('active');
        setupRoute();
        setupRealtime();
        checkLocationSharing();
        updateContributorsCount();
        setInterval(updateContributorsCount, 15000); // refresh every 15s
        
        // Fetch past arrivals to sync markers
        fetchPastArrivals();
      } else {
        navTitle.textContent = 'Bus 4 - Offline';
        offlineBanner.classList.add('active');
        // Still draw the default route for visual
        setupRoute(true);
      }
    } catch (err) {
      console.error('Error fetching trip:', err);
      navTitle.textContent = 'Bus 4 - Error';
      setupRoute(true);
    }
  }

  // 3. Setup Route on Map
  function setupRoute(isOffline = false) {
    const tripType = activeTrip ? activeTrip.trip_type : 'morning';
    routeData = getRoute(tripType, 'Bus 4');
    
    if (!routeData || routeData.length === 0) return;

    // Draw Polyline
    const latlngs = routeData.map(stop => [stop.lat, stop.lon]);
    routePolyline = L.polyline(latlngs, {
      color: 'var(--accent)',
      weight: 4,
      opacity: 0.8,
      lineJoin: 'round'
    }).addTo(map);

    map.fitBounds(routePolyline.getBounds(), { padding: [30, 30] });

    // Draw Stop Markers
    routeData.forEach((stop, index) => {
      const icon = L.divIcon({
        className: 'custom-stop-icon',
        html: `<div class="stop-marker" data-stop-index="${index}"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7]
      });

      const marker = L.marker([stop.lat, stop.lon], { icon }).addTo(map);
      marker.bindTooltip(stop.name, { direction: 'top', offset: [0, -10] });
      stopMarkers.push({ index, marker, name: stop.name });
    });
  }

  // 4. Check past arrivals (if joining mid-trip)
  async function fetchPastArrivals() {
    if (!activeTrip) return;
    const { data } = await supabase
      .from('stop_arrivals')
      .select('stop_index, stop_name')
      .eq('trip_id', activeTrip.id);
    
    if (data) {
      data.forEach(arrival => {
        markStopPassed(arrival.stop_index, arrival.stop_name);
      });
    }
  }

  // 5. Setup Realtime Subscriptions
  function setupRealtime() {
    if (!activeTrip) return;

    // Computed Locations (Speed and Bus Position)
    supabase.channel('public:computed_locations')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'computed_locations',
        filter: `trip_id=eq.${activeTrip.id}`
      }, (payload) => {
        updateBusPosition(payload.new.latitude, payload.new.longitude, payload.new.speed_kmh);
      })
      .subscribe();

    // Stop Arrivals
    supabase.channel('public:stop_arrivals')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'stop_arrivals',
        filter: `trip_id=eq.${activeTrip.id}`
      }, (payload) => {
        markStopPassed(payload.new.stop_index, payload.new.stop_name);
      })
      .subscribe();
      
    // Fetch initial latest location
    supabase.from('computed_locations')
      .select('latitude, longitude, speed_kmh')
      .eq('trip_id', activeTrip.id)
      .order('computed_at', { ascending: false })
      .limit(1)
      .then(({data}) => {
        if (data && data.length > 0) {
          updateBusPosition(data[0].latitude, data[0].longitude, data[0].speed_kmh);
        }
      });
  }

  function updateBusPosition(lat, lon, speed) {
    if (speed !== null) {
      speedEl.textContent = `${Math.round(speed)} km/h`;
    }

    if (!busMarker) {
      const busIcon = L.divIcon({
        className: 'custom-bus-icon',
        html: '<div class="bus-marker"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      });
      busMarker = L.marker([lat, lon], { icon: busIcon, zIndexOffset: 1000 }).addTo(map);
    } else {
      busMarker.setLatLng([lat, lon]);
    }
    
    // Optionally pan map slowly if bus moves near edge, but keep it simple for now
  }

  function markStopPassed(index, name) {
    positionEl.textContent = name;
    
    // Find the marker element in DOM and add 'passed' class
    const stopObj = stopMarkers.find(s => s.index === index || s.name === name);
    if (stopObj && stopObj.marker) {
      const iconElement = stopObj.marker.getElement();
      if (iconElement) {
        const inner = iconElement.querySelector('.stop-marker');
        if (inner) inner.classList.add('passed');
      }
    }
  }

  // 6. Contributors Count
  async function updateContributorsCount() {
    if (!activeTrip) return;
    try {
      // Get locations from last 30 seconds
      const thirtySecondsAgo = new Date(Date.now() - 30000).toISOString();
      const { data, error } = await supabase
        .from('bus_locations')
        .select('source_user_id')
        .eq('trip_id', activeTrip.id)
        .gte('submitted_at', thirtySecondsAgo);
      
      if (error) throw error;
      
      // Count unique users
      const uniqueUsers = new Set(data.map(d => d.source_user_id));
      contributorsEl.textContent = uniqueUsers.size;
    } catch (err) {
      console.error('Error fetching contributors:', err);
    }
  }

  // 7. Location Sharing Popup
  function checkLocationSharing() {
    const hasPrompted = sessionStorage.getItem('locationPrompted_bus4');
    if (!hasPrompted) {
      setTimeout(() => {
        locationPopup.classList.add('active');
      }, 1000); // slight delay for better UX
    }
  }

  btnShare.addEventListener('click', () => {
    sessionStorage.setItem('locationPrompted_bus4', 'true');
    locationPopup.classList.remove('active');
    
    // Request location and start sending
    if (window.startPassengerGPS) {
      localStorage.setItem('activeTripId', activeTrip.id);
      window.startPassengerGPS(activeTrip.id, 'Bus 4', session.role);
      alert('Location sharing started. Thank you for contributing!');
    }
  });

  btnNotNow.addEventListener('click', () => {
    sessionStorage.setItem('locationPrompted_bus4', 'true');
    locationPopup.classList.remove('active');
  });

  // Immediate Bus Location Fetch
  async function fetchLatestBusLocationImmediate() {
    try {
      const { data, error } = await supabase
        .from('computed_locations')
        .select('latitude, longitude, speed_kmh')
        .eq('bus_id', 'Bus 4')
        .order('computed_at', { ascending: false })
        .limit(1);
      
      if (error) throw error;
      if (data && data.length > 0) {
        const lat = parseFloat(data[0].latitude);
        const lon = parseFloat(data[0].longitude);
        const speed = data[0].speed_kmh;
        
        // Update position UI and marker instantly
        updateBusPosition(lat, lon, speed);
        
        // Focus map on the bus immediately if map exists
        if (map) {
          map.setView([lat, lon], 14);
        }
      }
    } catch (err) {
      console.warn('Could not fetch immediate bus location:', err);
    }
  }

  // Start the flow
  fetchLatestBusLocationImmediate();
  fetchActiveTrip();
});
