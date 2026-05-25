// js/dashboard.js

let busesData = [];
let driverSessions = [];

async function loadStudentDashboard() {
  const container = document.getElementById('bus-grid');
  if (!container) return;

  const [busesRes, sessionsRes] = await Promise.all([
    supabase.from('buses').select('*').order('id'),
    supabase.from('driver_sessions').select('*')
  ]);

  busesData = busesRes.data || [];
  driverSessions = sessionsRes.data || [];

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
    const isOnline = session && session.is_online;
    
    let lastSeenStr = 'Never active';
    if (session && session.last_seen) {
      const mins = Math.round((new Date() - new Date(session.last_seen)) / 60000);
      lastSeenStr = isOnline ? 'Active Now' : `Last active: ${mins} mins ago`;
    }

    const busPhotoHtml = bus.bus_photo_url 
      ? `<div style="height: 140px; background: url('${bus.bus_photo_url}') center/cover; position: relative;"></div>`
      : `<div style="height: 140px; background: #2a2a2a; display:flex; align-items:center; justify-content:center; font-size:32px; color:#555;"><i class="fas fa-bus"></i></div>`;

    const driverPhotoHtml = bus.driver_photo_url
      ? `<div style="width: 40px; height: 40px; border-radius: 50%; background: url('${bus.driver_photo_url}') center/cover; flex-shrink: 0;"></div>`
      : `<div style="width: 40px; height: 40px; border-radius: 50%; background: #333; display:flex; align-items:center; justify-content:center; color:#888;"><i class="fas fa-user"></i></div>`;

    const callBtnHtml = bus.driver_phone
      ? `<a href="tel:${bus.driver_phone.replace(/\s+/g,'')}" style="background: #10b981; color: white; padding: 6px 12px; border-radius: 8px; text-decoration: none; font-size: 12px; font-weight: 600; display:flex; align-items:center; gap: 6px;"><i class="fas fa-phone"></i> Call Driver</a>`
      : '';

    const card = document.createElement('div');
    card.className = `bus-card ${isOnline ? 'online' : 'offline'}`;
    // Using inline styles to override legacy card styles rapidly to match V3 requested premium UI without needing huge CSS edits
    card.style.padding = '0';
    card.style.overflow = 'hidden';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.textAlign = 'left';
    card.style.background = '#1a1a1a';
    card.style.color = '#ffffff';
    card.style.border = '1px solid #333333';
    
    card.innerHTML = `
      ${busPhotoHtml}
      <div style="position: absolute; top: 10px; right: 10px; background: ${isOnline ? 'rgba(16,185,129,0.9)' : 'rgba(239,68,68,0.9)'}; color: white; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight:bold; box-shadow: 0 2px 10px rgba(0,0,0,0.5);">
        ${isOnline ? 'ONLINE' : 'OFFLINE'}
      </div>
      
      <div style="padding: 20px; flex-grow: 1; display:flex; flex-direction:column;">
        <h2 style="margin: 0; font-size: 20px; font-weight: 700;">${bus.id}</h2>
        <p style="color: #aaa; font-size: 13px; font-weight: 500; margin: 4px 0 10px;"><i class="fas fa-route"></i> ${bus.route_name || 'No route assigned'}</p>
        
        <div style="display:flex; align-items:center; gap: 12px; margin-top: auto; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
          ${driverPhotoHtml}
          <div style="flex-grow: 1;">
            <p style="margin: 0; font-weight: 600; font-size: 14px;">${bus.driver_name || (session && session.driver_name) || 'No Driver'}</p>
            <p style="margin: 0; font-size: 11px; color: #888;">${lastSeenStr}</p>
          </div>
          ${callBtnHtml}
        </div>
      </div>
      
      <button style="border-radius: 0; padding: 15px; font-size: 14px; display:flex; justify-content:center; align-items:center; gap: 8px; border:none; border-top: 1px solid rgba(255,255,255,0.05);" class="track-btn ${isOnline ? '' : 'disabled'}" onclick="handleTrackClick('${bus.id}', ${isOnline})">
        ${isOnline ? '<i class="fas fa-map-marker-alt"></i> Track Live Location' : '<i class="fas fa-bed"></i> Currently Offline'}
      </button>
    `;
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
  supabase.channel('student-dashboard-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'buses' }, () => loadStudentDashboard())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_sessions' }, () => loadStudentDashboard())
    .subscribe();
}

// Initial Call
document.addEventListener('DOMContentLoaded', () => {
  loadStudentDashboard();
  subscribeToStudentSync();
  
  // Fallback polling in case Supabase Realtime is not enabled for these tables
  setInterval(() => {
    loadStudentDashboard();
  }, 30000);
});
