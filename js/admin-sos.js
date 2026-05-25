// js/admin-sos.js

document.addEventListener('DOMContentLoaded', () => {
  loadSOSAlerts();
  subscribeToRealtime();
});

async function loadSOSAlerts() {
  const container = document.getElementById('alerts-container');
  
  const { data: alerts, error } = await supabase
    .from('sos_alerts')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  if (error) {
    console.error(error);
    container.innerHTML = `<div style="grid-column:1/-1; color:var(--danger); text-align:center;">Failed to load alerts.</div>`;
    return;
  }

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
    
    let lat = alert.latitude ? Number(alert.latitude).toFixed(5) : 'Unknown';
    let lng = alert.longitude ? Number(alert.longitude).toFixed(5) : 'Unknown';
    let mapsLink = '';
    if (alert.latitude && alert.longitude) {
      mapsLink = `<a href="https://www.google.com/maps?q=${alert.latitude},${alert.longitude}" target="_blank" class="map-btn"><i class="fas fa-map-marker-alt"></i> View on Map</a>`;
    }

    card.innerHTML = `
      <div class="card-top">
        <div>
          <div class="bus-id">${alert.bus_id}</div>
          <div class="time-stamp">${timeStr}</div>
        </div>
        <div class="pulse-badge">
          <div class="pulse-dot"></div>
          ACTIVE SOS
        </div>
      </div>
      
      <div class="info-grid">
        <div class="info-item">
          <span class="info-label">Driver Name</span>
          <span class="info-value">${alert.driver_name || 'N/A'}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Last Known Location</span>
          <span class="info-value" style="display:flex; flex-direction:column; gap:8px;">
            <span style="font-size: 15px; line-height: 1.4; color: var(--sos-gray); font-weight: 500;">${alert.placeName}</span>
            <div>${mapsLink}</div>
          </span>
        </div>
      </div>
      
      <button class="btn-resolve" onclick="resolveAlert('${alert.bus_id}')">
        <i class="fas fa-check"></i> Mark as Resolved
      </button>
    `;
    
    container.appendChild(card);
  });
}

async function resolveAlert(busId) {
  if (!confirm(`Are you sure you want to resolve the SOS alert for ${busId}?`)) return;
  
  const { error } = await supabase
    .from('sos_alerts')
    .update({ status: 'resolved' })
    .eq('bus_id', busId)
    .eq('status', 'active');
    
  if (error) {
    alert("Error resolving alert: " + error.message);
  } else {
    const session = JSON.parse(localStorage.getItem('adminSession'));
    const adminName = session ? session.username : 'Admin';
    await supabase.from('admin_logs').insert({
      admin_username: adminName,
      action_text: `Resolved SOS alert for ${busId}`
    });
    
    loadSOSAlerts();
  }
}

function subscribeToRealtime() {
  supabase.channel('admin-sos-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sos_alerts' }, () => {
      loadSOSAlerts();
    })
    .subscribe();
}
