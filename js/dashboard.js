async function renderBusCards() {
  const grid = document.getElementById('bus-grid');
  if (!grid) return;

  grid.innerHTML = '';

  const { data: activeTrips } = await supabase
    .from('trips')
    .select('*')
    .eq('status', 'active');

  const onlineBusIds = activeTrips ? activeTrips.map(t => t.bus_id) : [];

  Object.entries(window.BUSES).forEach(([busName, config]) => {
    const isOnline = onlineBusIds.includes(busName);
    const card = document.createElement('div');
    card.className = `bus-card ${isOnline ? 'online' : ''}`;

    card.innerHTML = `
      <div class="status-dot"></div>
      <div class="bus-info">
        <h3>${busName}</h3>
        <p>${config.hasRoute ? 'Route Available' : 'No Route Available'}</p>
        <span class="status-label">${isOnline ? 'ONLINE' : 'OFFLINE'}</span>
      </div>
      <button class="track-btn" onclick="handleTrackBus('${busName}', ${config.hasRoute}, ${isOnline})">
        ${isOnline ? 'Track Bus' : 'View Schedule'}
      </button>
    `;
    grid.appendChild(card);
  });
}

function handleTrackBus(busId, hasRoute, isOnline) {
  if (!hasRoute) {
    alert("Route not available for this bus.");
    return;
  }
  if (!isOnline) {
    alert("Bus is currently offline.");
    return;
  }

  window.location.href = `bus-track.html?busId=${busId}`;
}

window.renderBusCards = renderBusCards;
