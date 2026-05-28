// js/dashboard.js

let busesData = [];
let driverSessions = [];

let activeTripsData = [];

async function loadStudentDashboard() {
  const container = document.getElementById('bus-grid');
  if (!container) return;

  const [busesRes, sessionsRes, tripsRes] = await Promise.all([
    supabase.from('buses').select('*').order('id'),
    supabase.from('driver_sessions').select('*'),
    supabase.from('trips').select('bus_id').eq('status', 'active')
  ]);

  busesData = busesRes.data || [];
  driverSessions = sessionsRes.data || [];
  activeTripsData = tripsRes.data || [];

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
    
    // Bus is only "Online" to the student if the driver is connected AND has an active trip running
    let isOnline = session && session.is_online && hasActiveTrip;
    let lastSeenStr = 'Never active';

    if (session && session.last_seen) {
      const timeDiffMs = new Date() - new Date(session.last_seen);
      const mins = Math.round(timeDiffMs / 60000);
      
      // Safety check: if heartbeat is older than 90 seconds, force offline in UI
      if (timeDiffMs > 90000) {
          isOnline = false;
      }
      
      // If they are connected but just don't have an active trip, we can still show their last connection
      if (session.is_online && timeDiffMs <= 90000 && !hasActiveTrip) {
          lastSeenStr = 'Connected - Idle (No active trip)';
      } else {
          let formattedTime = '';
          const hours = Math.floor(mins / 60);
          const days = Math.floor(hours / 24);
          const months = Math.floor(days / 30);
          const years = Math.floor(days / 365);
          
          if (years > 0) formattedTime = `${years} year${years > 1 ? 's' : ''} ago`;
          else if (months > 0) formattedTime = `${months} month${months > 1 ? 's' : ''} ago`;
          else if (days > 0) formattedTime = `${days} day${days > 1 ? 's' : ''} ago`;
          else if (hours > 0) formattedTime = `${hours} hour${hours > 1 ? 's' : ''} ago`;
          else formattedTime = `${mins} min${mins !== 1 ? 's' : ''} ago`;

          lastSeenStr = isOnline ? 'Active Now' : `Last active: ${formattedTime}`;
      }
    }

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
    card.style.border = isOnline ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid #333333';
    if (isOnline) {
        card.style.boxShadow = '0 8px 32px rgba(16, 185, 129, 0.1)';
    }
    
    card.innerHTML = `
      <div class="bus-photo-container" style="height: 140px; position: relative; background: #2a2a2a; display:flex; align-items:center; justify-content:center; font-size:32px; color:#555;">
        <i class="fas fa-bus bus-icon"></i>
      </div>
      <div style="position: absolute; top: 10px; right: 10px; color: white; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight:bold; box-shadow: 0 2px 10px rgba(0,0,0,0.5);" class="status-badge">
      </div>
      
      <div style="padding: 20px; flex-grow: 1; display:flex; flex-direction:column;">
        <h2 style="margin: 0; font-size: 20px; font-weight: 700;" class="bus-id-val"></h2>
        <p style="color: #aaa; font-size: 13px; font-weight: 500; margin: 4px 0 10px;"><i class="fas fa-route"></i> <span class="route-name-val"></span></p>
        
        <div style="display:flex; align-items:center; gap: 12px; margin-top: auto; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
          <div class="driver-photo-container" style="width: 40px; height: 40px; border-radius: 50%; background: #333; display:flex; align-items:center; justify-content:center; color:#888; flex-shrink: 0;">
            <i class="fas fa-user driver-icon"></i>
          </div>
          <div style="flex-grow: 1;">
            <p style="margin: 0; font-weight: 600; font-size: 14px;" class="driver-name-val"></p>
            <p style="margin: 0; font-size: 11px; color: #888;" class="last-seen-val"></p>
          </div>
          <div class="call-btn-container"></div>
        </div>
      </div>
      
      <button style="border-radius: 0; padding: 15px; font-size: 14px; display:flex; justify-content:center; align-items:center; gap: 8px; border:none; border-top: 1px solid rgba(255,255,255,0.05); transition: background 0.2s;" class="track-btn">
      </button>
    `;

    if (bus.bus_photo_url) {
        // Strip out single quotes or double quotes to prevent CSS injection via url()
        const safeUrl = bus.bus_photo_url.replace(/['"]/g, '');
        card.querySelector('.bus-photo-container').style.backgroundImage = `url('${encodeURI(safeUrl)}')`;
        card.querySelector('.bus-photo-container').style.backgroundPosition = 'center';
        card.querySelector('.bus-photo-container').style.backgroundSize = 'cover';
        card.querySelector('.bus-icon').style.display = 'none';
    }
    
    const badge = card.querySelector('.status-badge');
    badge.style.background = isOnline ? 'rgba(16,185,129,0.9)' : 'rgba(239,68,68,0.9)';
    badge.textContent = isOnline ? 'ONLINE' : 'OFFLINE';
    
    card.querySelector('.bus-id-val').textContent = bus.id;
    card.querySelector('.route-name-val').textContent = bus.route_name || 'No route assigned';
    
    if (bus.driver_photo_url) {
        const safeDriverUrl = bus.driver_photo_url.replace(/['"]/g, '');
        card.querySelector('.driver-photo-container').style.backgroundImage = `url('${encodeURI(safeDriverUrl)}')`;
        card.querySelector('.driver-photo-container').style.backgroundPosition = 'center';
        card.querySelector('.driver-photo-container').style.backgroundSize = 'cover';
        card.querySelector('.driver-icon').style.display = 'none';
    }
    
    card.querySelector('.driver-name-val').textContent = bus.driver_name || (session && session.driver_name) || 'No Driver';
    card.querySelector('.last-seen-val').textContent = lastSeenStr;
    
    if (bus.driver_phone) {
        const callBtn = document.createElement('a');
        callBtn.href = `tel:${bus.driver_phone.replace(/\s+/g,'')}`;
        callBtn.style.background = '#10b981';
        callBtn.style.color = 'white';
        callBtn.style.padding = '6px 12px';
        callBtn.style.borderRadius = '8px';
        callBtn.style.textDecoration = 'none';
        callBtn.style.fontSize = '12px';
        callBtn.style.fontWeight = '600';
        callBtn.style.display = 'flex';
        callBtn.style.alignItems = 'center';
        callBtn.style.gap = '6px';
        callBtn.innerHTML = '<i class="fas fa-phone"></i> Call Driver';
        card.querySelector('.call-btn-container').appendChild(callBtn);
    }
    
    const trackBtn = card.querySelector('.track-btn');
    trackBtn.style.background = isOnline ? '#10b981' : '#2a2a2a';
    trackBtn.style.color = isOnline ? '#ffffff' : '#888888';
    trackBtn.style.cursor = isOnline ? 'pointer' : 'default';
    if (!isOnline) trackBtn.classList.add('disabled');
    trackBtn.innerHTML = isOnline ? '<i class="fas fa-map-marker-alt"></i> Track Live Location' : '<i class="fas fa-bed"></i> Currently Offline';
    
    if (isOnline) {
        trackBtn.addEventListener('click', () => handleTrackClick(bus.id, isOnline));
        trackBtn.addEventListener('mouseover', () => trackBtn.style.background = '#059669');
        trackBtn.addEventListener('mouseout', () => trackBtn.style.background = '#10b981');
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
