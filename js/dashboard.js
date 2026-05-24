const busStatusCache = {
  data: null,
  timestamp: 0,
  TTL: 30000
};

async function getBusStatusCached() {
  const now = Date.now();

  if (busStatusCache.data && (now - busStatusCache.timestamp) < busStatusCache.TTL) {
    console.log('[Cache] Returning cached bus status');
    return busStatusCache.data;
  }

  const { data: activeTrips } = await supabase
    .from('trips')
    .select('bus_id')
    .eq('status', 'active');

  const onlineBuses = new Set((activeTrips || []).map(t => t.bus_id));

  busStatusCache.data = onlineBuses;
  busStatusCache.timestamp = now;
  console.log('[Cache] Bus status refreshed from Supabase');

  return onlineBuses;
}

async function renderBusCards() {
  const container = document.getElementById('bus-grid');
  if (!container) return;

  // 1. Get current active trips using the cache
  const onlineBuses = await getBusStatusCached();
  const activeBuses = Array.from(onlineBuses);

  // 2. Define the fleet (as per instructions: Bus 1 to Bus 6)
  const fleet = [
    { id: 'Bus 1', driver: 'driver1' },
    { id: 'Bus 2', driver: 'driver2' },
    { id: 'Bus 3', driver: 'driver3' },
    { id: 'Bus 4', driver: 'driver4' },
    { id: 'Bus 5', driver: 'driver5' },
    { id: 'Bus 6', driver: 'driver6' },
  ];

  // 3. Clear container
  container.innerHTML = '';

  // 4. Render cards
  fleet.forEach(bus => {
    const isOnline = activeBuses.includes(bus.id);
    const hasRoute = bus.id === 'Bus 4'; // Requirement 3

    const card = document.createElement('div');
    card.className = `bus-card ${isOnline ? 'online' : 'offline'}`;
    
    card.innerHTML = `
      <div class="status-badge ${isOnline ? 'online' : 'offline'}">
        ${isOnline ? 'ONLINE' : 'OFFLINE'}
      </div>
      <div class="bus-icon-bg">
        <i class="fas fa-bus"></i>
      </div>
      <h2>Bus ${bus.id.toLowerCase().replace(' ', '')}</h2>
      <p class="driver-text">Driver: <span class="driver-name">${bus.driver}</span></p>
      <button class="track-btn ${isOnline ? '' : 'disabled'}" onclick="handleTrackClick('${bus.id}', ${isOnline}, ${hasRoute})">
        ${isOnline ? 'Track Live Location' : 'OFFLINE'}
      </button>
    `;
    container.appendChild(card);
  });
}

function handleTrackClick(busId, isOnline, hasRoute) {
  if (!isOnline) return;

  // Route check removed so all active buses can be tracked
  const busParam = busId.replace(' ', ''); // 'Bus 4' -> 'Bus4'
  window.location.href = `student-console.html?bus=${busParam}`;
}

// Initial Call
document.addEventListener('DOMContentLoaded', renderBusCards);
window.renderBusCards = renderBusCards;
setInterval(renderBusCards, 10000);
