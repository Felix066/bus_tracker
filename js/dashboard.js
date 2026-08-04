// js/dashboard.js

let busesData = [];
let driverSessions = [];

let activeTripsData = [];

async function loadStudentDashboard() {
  const container = document.getElementById('bus-grid');
  if (!container) return;

  try {
    const res = await fetch(`${BACKEND_URL}/api/public/buses`);
    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        busesData = data.buses || [];
        driverSessions = data.sessions || [];
        activeTripsData = data.activeTrips || [];
      }
    }
  } catch (err) {
    console.error("Failed to load dashboard from backend", err);
  }

  renderBusCards();
}

function renderBusCards() {
  const container = document.getElementById('bus-grid');
  if (!container) return;
  container.innerHTML = '';

  if (busesData.length === 0) {
    container.innerHTML = '<div style="text-align:center; padding: 40px; color:#888;">No buses currently available.</div>';
    return;
  }

  busesData.forEach(bus => {
    const session = driverSessions.find(s => s.bus_id === bus.id);
    const hasActiveTrip = activeTripsData.some(t => t.bus_id === bus.id);
    
    let isOnline = session && session.is_online && hasActiveTrip;
    let lastSeenStr = 'Never active';

    if (session && session.last_seen) {
      const timeDiffMs = new Date() - new Date(session.last_seen);
      const mins = Math.round(timeDiffMs / 60000);
      
      if (timeDiffMs > 90000) {
          isOnline = false;
      }
      
      if (session.is_online && timeDiffMs <= 90000 && !hasActiveTrip) {
          lastSeenStr = 'Connected - Idle (No active trip)';
      } else {
          let formattedTime = '';
          const hours = Math.floor(mins / 60);
          const days = Math.floor(hours / 24);
          
          if (days > 0) formattedTime = `${days} day${days > 1 ? 's' : ''} ago`;
          else if (hours > 0) formattedTime = `${hours} hour${hours > 1 ? 's' : ''} ago`;
          else formattedTime = `${mins} min${mins !== 1 ? 's' : ''} ago`;

          lastSeenStr = isOnline ? 'Active Now' : `Last active: ${formattedTime}`;
      }
    }

    const card = document.createElement('div');
    card.className = `bus-card ${isOnline ? 'online' : 'offline'}`;
    
    let photoHtml = '';
    let defaultIconHtml = '<div class="bus-icon"><i class="fas fa-bus"></i></div>';
    
    if (bus.bus_photo_url) {
        const safeUrl = bus.bus_photo_url.replace(/['"]/g, '');
        photoHtml = `<div style="width: 100%; height: 160px; border-radius: 16px; margin-bottom: 16px; background-image: url('${encodeURI(safeUrl)}'); background-position: center; background-size: cover; box-shadow: 0 4px 12px rgba(0,0,0,0.1);"></div>`;
        defaultIconHtml = ''; 
    }

    let driverHtml = '';
    if (bus.driver_photo_url) {
        const safeDriverUrl = bus.driver_photo_url.replace(/['"]/g, '');
        driverHtml = `<div style="width: 40px; height: 40px; border-radius: 50%; background-image: url('${encodeURI(safeDriverUrl)}'); background-position: center; background-size: cover; flex-shrink: 0;"></div>`;
    } else {
        driverHtml = `<div style="width: 40px; height: 40px; border-radius: 50%; background: #e2e8f0; display:flex; align-items:center; justify-content:center; color:#64748b; flex-shrink: 0;"><i class="fas fa-user"></i></div>`;
    }

    let callBtnHtml = '';
    if (bus.driver_phone) {
        const safePhone = bus.driver_phone.replace(/\s+/g,'');
        callBtnHtml = `<a href="tel:${safePhone}" style="margin-left: auto; background: rgba(16, 185, 129, 0.1); color: #059669; padding: 8px 12px; border-radius: 12px; text-decoration: none; font-size: 13px; font-weight: 600; transition: background 0.2s;"><i class="fas fa-phone"></i></a>`;
    }

    card.innerHTML = `
      ${photoHtml}
      <div class="card-top">
        <div style="display: flex; align-items: center; gap: 16px;">
          ${defaultIconHtml}
          <div>
            <h2 class="bus-name">${bus.id}</h2>
            <div class="trip-tag" style="margin-top: 4px;"><i class="fas fa-route"></i> ${bus.route_name || 'No route assigned'}</div>
          </div>
        </div>
        <div class="status-badge ${isOnline ? 'online' : 'offline'}">
          <div class="status-dot ${isOnline ? 'online' : 'offline'}"></div>
          ${isOnline ? 'ONLINE' : 'OFFLINE'}
        </div>
      </div>
      
      <div style="margin-top: auto; padding-top: 20px; border-top: 1px solid rgba(0,0,0,0.05); display: flex; align-items: center; gap: 12px;">
        ${driverHtml}
        <div class="driver-info" style="display:flex; flex-direction:column; line-height: 1.4;">
          <strong style="font-size: 15px;">${bus.driver_name || (session && session.driver_name) || 'No Driver'}</strong>
          <span style="font-size: 12px;">${lastSeenStr}</span>
        </div>
        ${callBtnHtml}
      </div>
      
      <button class="track-btn ${isOnline ? 'active' : 'inactive'}">
        ${isOnline ? '<i class="fas fa-map-marker-alt"></i> Track Live Location' : '<i class="fas fa-bed"></i> Currently Offline'}
      </button>
    `;

    const trackBtn = card.querySelector('.track-btn');
    if (isOnline) {
        trackBtn.addEventListener('click', () => handleTrackClick(bus.id, isOnline));
    }
    
    container.appendChild(card);
  });
}

function handleTrackClick(busId, isOnline) {
  if (!isOnline) return;
  const busParam = busId.replace(/\s+/g, ''); // 'Bus 4' -> 'Bus4'
  window.location.href = `student-console.html?bus=${busParam}`;
}

// Setup Realtime 
function subscribeToStudentSync() {
  if (!window.supabase) return;
  supabase.channel('student-dashboard-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'buses' }, () => loadStudentDashboard())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_sessions' }, () => loadStudentDashboard())
    .subscribe();
}

// Initial Call
document.addEventListener('DOMContentLoaded', () => {
  loadStudentDashboard();
  subscribeToStudentSync();
  
  // Hard refresh the tab every 30 seconds as requested
  setInterval(() => {
    window.location.reload();
  }, 30000);
});
