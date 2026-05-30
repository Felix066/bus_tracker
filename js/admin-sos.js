// js/admin-sos.js

document.addEventListener('DOMContentLoaded', () => {
  loadSOSAlerts();
  subscribeToRealtime();
});

async function loadSOSAlerts() {
  const container = document.getElementById('alerts-container');
  
  try {
    const token = JSON.parse(localStorage.getItem('adminSession'))?.token;
    const res = await fetch(`${BACKEND_URL}/api/admin/sos-alerts`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!res.ok) throw new Error("Failed to load alerts from backend");
    
    const data = await res.json();
    const alerts = data.data || [];

  // Deduplicate by bus_id keeping the latest one
  const uniqueAlerts = [];
  const seenBuses = new Set();
  alerts.forEach(alert => {
    if (!seenBuses.has(alert.bus_id)) {
      uniqueAlerts.push(alert);
      seenBuses.add(alert.bus_id);
    }
  });

  if (uniqueAlerts.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon"><i class="fas fa-check-circle"></i></div>
        <h2>All Clear</h2>
        <p>There are no active emergency alerts.</p>
      </div>
    `;
    return;
  }

  // Reverse geocode for readable place names
  await Promise.all(uniqueAlerts.map(async (alert) => {
    if (alert.latitude && alert.longitude) {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${alert.latitude}&lon=${alert.longitude}`);
        if (!res.ok) throw new Error("Network response was not ok");
        const data = await res.json();
        alert.placeName = data.display_name || 'Location details unavailable';
      } catch (e) {
        alert.placeName = 'Location details unavailable';
      }
    } else {
      alert.placeName = 'Coordinates not available';
    }
  }));

  container.innerHTML = '';
  
  uniqueAlerts.forEach(alert => {
    const card = document.createElement('div');
    card.className = 'sos-card';
    
    const d = new Date(alert.created_at);
    const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' + d.toLocaleDateString();

    card.innerHTML = `
      <div class="card-top">
        <div>
          <div class="bus-id"></div>
          <div class="time-stamp"></div>
        </div>
        <div class="pulse-badge">
          <div class="pulse-dot"></div>
          ACTIVE SOS
        </div>
      </div>
      
      <div class="info-grid">
        <div class="info-item">
          <span class="info-label">Driver Name</span>
          <span class="info-value driver-name-val"></span>
        </div>
        <div class="info-item">
          <span class="info-label">Last Known Location</span>
          <span class="info-value" style="display:flex; flex-direction:column; gap:8px;">
            <span class="place-name-val" style="font-size: 15px; line-height: 1.4; color: var(--sos-gray); font-weight: 500;"></span>
            <div class="map-link-container"></div>
          </span>
        </div>
      </div>
      
      <button class="btn-resolve">
        <i class="fas fa-check"></i> Mark as Resolved
      </button>
    `;

    card.querySelector('.bus-id').textContent = alert.bus_id;
    card.querySelector('.time-stamp').textContent = timeStr;
    card.querySelector('.driver-name-val').textContent = alert.driver_name || 'N/A';
    card.querySelector('.place-name-val').textContent = alert.placeName;

    if (alert.latitude && alert.longitude) {
      const mapLink = document.createElement('a');
      mapLink.href = `https://www.google.com/maps?q=${encodeURIComponent(alert.latitude)},${encodeURIComponent(alert.longitude)}`;
      mapLink.target = '_blank';
      mapLink.className = 'map-btn';
      mapLink.innerHTML = '<i class="fas fa-map-marker-alt"></i> View on Map';
      card.querySelector('.map-link-container').appendChild(mapLink);
    }
    
    card.querySelector('.btn-resolve').addEventListener('click', () => resolveAlert(alert.bus_id));
    
    container.appendChild(card);
  } catch (err) {
    console.error(err);
    container.innerHTML = `<div style="grid-column:1/-1; color:var(--danger); text-align:center;">Failed to load alerts.</div>`;
  }
}

async function resolveAlert(busId) {
  if (!confirm(`Are you sure you want to resolve the SOS alert for ${busId}?`)) return;
  
  const token = JSON.parse(localStorage.getItem('adminSession'))?.token;
  try {
    const res = await fetch(`${BACKEND_URL}/api/admin/sos-alerts/${busId}/resolve`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to resolve alert");
    }
    
    loadSOSAlerts();
  } catch(e) {
    alert("Error resolving alert: " + e.message);
  }
}

function subscribeToRealtime() {
  if (!window.supabase) return;
  supabase.channel('admin-sos-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sos_alerts' }, () => {
      loadSOSAlerts();
    })
    .subscribe();
}
