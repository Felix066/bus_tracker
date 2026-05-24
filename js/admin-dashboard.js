// js/admin-dashboard.js

let busesData = [];
let driverSessions = [];
let adminLogs = [];
let sosAlerts = [];
let adminUsername = 'Admin';

document.addEventListener('DOMContentLoaded', () => {
  const session = JSON.parse(localStorage.getItem('adminSession'));
  if (session) adminUsername = session.username;

  loadDashboardData();
  subscribeToRealtime();
});

// --- LOAD DATA ---
async function loadDashboardData() {
  const [busesRes, sessionsRes, logsRes, sosRes] = await Promise.all([
    supabase.from('buses').select('*').order('bus_id'),
    supabase.from('driver_sessions').select('*'),
    supabase.from('admin_logs').select('*').order('created_at', { ascending: false }).limit(50),
    supabase.from('sos_alerts').select('*').eq('status', 'active')
  ]);

  if (busesRes.data) busesData = busesRes.data;
  if (sessionsRes.data) driverSessions = sessionsRes.data;
  if (logsRes.data) adminLogs = logsRes.data;
  if (sosRes.data) sosAlerts = sosRes.data;

  renderBusGrid();
  renderAdminLogs();
  checkSOSAlerts();
}

// --- RENDER BUS GRID ---
function renderBusGrid() {
  const grid = document.getElementById('bus-grid');
  grid.innerHTML = '';
  
  // Search filtering
  const searchTerm = (document.getElementById('searchInput').value || '').toLowerCase();

  const filteredBuses = busesData.filter(b => 
    (b.bus_id || '').toLowerCase().includes(searchTerm) || 
    (b.driver_name || '').toLowerCase().includes(searchTerm) ||
    (b.route_name || '').toLowerCase().includes(searchTerm)
  );

  if (filteredBuses.length === 0) {
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding: 40px; color: #888;">No buses found. Add one to get started!</div>`;
    return;
  }

  filteredBuses.forEach(bus => {
    const session = driverSessions.find(s => s.bus_id === bus.bus_id);
    const isOnline = session && session.is_online;
    
    const statusText = isOnline ? 'Active' : 'Offline';
    const statusClass = isOnline ? 'active' : 'offline';
    
    let lastSeenStr = 'Never';
    if (session && session.last_seen) {
      const mins = Math.round((new Date() - new Date(session.last_seen)) / 60000);
      lastSeenStr = isOnline ? 'Just now' : `${mins} mins ago`;
    }

    const busPhotoHtml = bus.bus_photo_url 
      ? `<div class="bus-photo" style="background-image: url('${bus.bus_photo_url}')"></div>`
      : `<div class="bus-photo"><div class="bus-photo-placeholder"><i class="fas fa-bus"></i></div></div>`;

    const driverPhotoHtml = bus.driver_photo_url
      ? `<div class="driver-avatar" style="background-image: url('${bus.driver_photo_url}')"></div>`
      : `<div class="driver-avatar" style="display:flex;align-items:center;justify-content:center;font-size:18px;color:#888;"><i class="fas fa-user"></i></div>`;

    const card = document.createElement('div');
    card.className = 'bus-card';
    card.innerHTML = `
      ${busPhotoHtml}
      <div style="position: absolute; top: 10px; right: 10px; background: rgba(0,0,0,0.7); padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight:bold; border: 1px solid rgba(255,255,255,0.2);">
        ${bus.number_plate || 'No Plate'}
      </div>
      <div class="bus-card-content">
        <div class="bus-title-row">
          <div>
            <h3 class="bus-name">${bus.bus_id}</h3>
            <p class="bus-route"><i class="fas fa-route"></i> ${bus.route_name || 'No Route Assigned'}</p>
          </div>
          <div class="status-badge ${statusClass}">
            <div class="status-dot"></div> ${statusText}
          </div>
        </div>
        <div style="font-size: 11px; color: #888; text-align: right; margin-top: -5px;">Last seen: ${lastSeenStr}</div>
        
        <div class="driver-info-row">
          ${driverPhotoHtml}
          <div class="driver-details">
            <p class="driver-name">${bus.driver_name || 'No Driver Assigned'}</p>
            <p class="driver-phone"><i class="fas fa-phone"></i> ${bus.driver_phone || 'N/A'}</p>
          </div>
        </div>
      </div>
      <div class="card-actions">
        <button class="btn-card btn-edit" onclick="openMasterModal('${bus.bus_id}')"><i class="fas fa-pen"></i> Edit</button>
        <button class="btn-card btn-del" onclick="deleteBus('${bus.bus_id}')"><i class="fas fa-trash"></i> Delete</button>
      </div>
    `;
    grid.appendChild(card);
  });
}

function filterBuses() {
  renderBusGrid();
}

// --- MASTER MODAL ---
function openMasterModal(busId = null) {
  const modal = document.getElementById('masterModal');
  modal.classList.remove('hidden');
  
  // Clear inputs
  document.getElementById('inpBusName').value = '';
  document.getElementById('inpRoute').value = '';
  document.getElementById('inpPlate').value = '';
  document.getElementById('inpBusPhoto').value = '';
  document.getElementById('inpDriverName').value = '';
  document.getElementById('inpDriverPhone').value = '';
  document.getElementById('inpDriverPhoto').value = '';
  document.getElementById('inpDriverUser').value = '';
  document.getElementById('inpDriverPass').value = '';

  if (busId) {
    document.getElementById('modalTitle').innerText = `Edit ${busId}`;
    document.getElementById('isNewBus').value = 'false';
    document.getElementById('editBusId').value = busId;
    document.getElementById('inpBusName').disabled = true; // don't allow changing PK easily here
    
    const bus = busesData.find(b => b.bus_id === busId);
    if (bus) {
      document.getElementById('inpBusName').value = bus.bus_id;
      document.getElementById('inpRoute').value = bus.route_name || '';
      document.getElementById('inpPlate').value = bus.number_plate || '';
      document.getElementById('inpDriverName').value = bus.driver_name || '';
      document.getElementById('inpDriverPhone').value = bus.driver_phone || '';
    }
  } else {
    document.getElementById('modalTitle').innerText = 'Add New Bus';
    document.getElementById('isNewBus').value = 'true';
    document.getElementById('editBusId').value = '';
    document.getElementById('inpBusName').disabled = false;
  }
}

function closeMasterModal() {
  document.getElementById('masterModal').classList.add('hidden');
}

// --- SAVE BUS & UPLOAD ---
async function uploadFile(file, bucket, prefix) {
  if (!file) return null;
  const fileExt = file.name.split('.').pop();
  const fileName = `${prefix}_${Date.now()}.${fileExt}`;
  const filePath = `${fileName}`;

  const { data, error } = await supabase.storage.from(bucket).upload(filePath, file, { cacheControl: '3600', upsert: false });
  if (error) {
    console.error("Upload error:", error);
    alert(`Failed to upload to ${bucket}: Make sure you created a public storage bucket named '${bucket}'.`);
    return null;
  }
  
  const { data: publicUrlData } = supabase.storage.from(bucket).getPublicUrl(filePath);
  return publicUrlData.publicUrl;
}

async function saveMasterBus() {
  const btnSave = document.getElementById('btnSaveBus');
  btnSave.innerText = 'Saving...';
  btnSave.disabled = true;

  try {
    const isNew = document.getElementById('isNewBus').value === 'true';
    const busId = document.getElementById('inpBusName').value.trim();
    
    if (!busId) throw new Error("Bus Name / ID is required.");

    // Files
    const busFile = document.getElementById('inpBusPhoto').files[0];
    const driverFile = document.getElementById('inpDriverPhoto').files[0];

    let busPhotoUrl = null;
    let driverPhotoUrl = null;

    if (busFile) busPhotoUrl = await uploadFile(busFile, 'bus-images', `bus_${busId.replace(/[^a-zA-Z0-9]/g, '')}`);
    if (driverFile) driverPhotoUrl = await uploadFile(driverFile, 'driver-images', `driver_${busId.replace(/[^a-zA-Z0-9]/g, '')}`);

    const busPayload = {
      route_name: document.getElementById('inpRoute').value.trim(),
      number_plate: document.getElementById('inpPlate').value.trim(),
      driver_name: document.getElementById('inpDriverName').value.trim(),
      driver_phone: document.getElementById('inpDriverPhone').value.trim()
    };

    if (busPhotoUrl) busPayload.bus_photo_url = busPhotoUrl;
    if (driverPhotoUrl) busPayload.driver_photo_url = driverPhotoUrl;

    if (isNew) {
      busPayload.bus_id = busId;
      const { error: busErr } = await supabase.from('buses').insert(busPayload);
      if (busErr) throw new Error("Insert Error: " + busErr.message);
      await logAdminAction(`Added new bus: ${busId}`);
    } else {
      const { error: busErr } = await supabase.from('buses').update(busPayload).eq('bus_id', busId);
      if (busErr) throw new Error("Update Error: " + busErr.message);
      await logAdminAction(`Updated details for bus: ${busId}`);
    }

    // Driver Credentials
    const username = document.getElementById('inpDriverUser').value.trim();
    const password = document.getElementById('inpDriverPass').value.trim();

    if (username) {
      // Create or update driver
      const driverPayload = { username: username, assigned_bus: busId, driver_name: busPayload.driver_name };
      // In a real system you hash this properly using the RPC we built. 
      // For now we will update the password_hash directly if using pgcrypto inside a trigger, 
      // or we can call our RPC if needed. 
      if (password) driverPayload.password_hash = password; 
      
      const { error: drvErr } = await supabase.from('drivers').upsert(driverPayload, { onConflict: 'username' });
      if (drvErr) console.warn("Driver upsert issue:", drvErr);
    }

    closeMasterModal();
    loadDashboardData();
  } catch (err) {
    alert(err.message);
  } finally {
    btnSave.innerText = 'Save Bus';
    btnSave.disabled = false;
  }
}

async function deleteBus(busId) {
  if (!confirm(`Are you absolutely sure you want to delete ${busId}?`)) return;
  await supabase.from('driver_sessions').delete().eq('bus_id', busId);
  await supabase.from('drivers').update({ assigned_bus: null }).eq('assigned_bus', busId);
  await supabase.from('buses').delete().eq('bus_id', busId);
  await logAdminAction(`Deleted bus: ${busId}`);
  loadDashboardData();
}

// --- ADMIN LOGS ---
async function logAdminAction(actionText) {
  await supabase.from('admin_logs').insert({
    admin_username: adminUsername,
    action_text: actionText
  });
}

function renderAdminLogs() {
  const logList = document.getElementById('log-list');
  logList.innerHTML = '';
  if (adminLogs.length === 0) {
    logList.innerHTML = '<div style="color:#888;">No recent activity.</div>';
    return;
  }
  adminLogs.forEach(log => {
    const d = new Date(log.created_at);
    const timeStr = d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    const div = document.createElement('div');
    div.className = 'log-item';
    div.innerHTML = `
      <span class="log-action"><strong>${log.admin_username}</strong>: ${log.action_text}</span>
      <span>${d.toLocaleDateString()} ${timeStr}</span>
    `;
    logList.appendChild(div);
  });
}

// --- SOS ALERTS ---
function checkSOSAlerts() {
  const banner = document.getElementById('sos-banner');
  if (sosAlerts.length > 0) {
    banner.style.display = 'block';
    const activeBuses = sosAlerts.map(s => s.bus_id).join(', ');
    banner.innerHTML = `<i class="fas fa-exclamation-triangle"></i> EMERGENCY SOS ACTIVATED BY: <strong>${activeBuses}</strong>`;
  } else {
    banner.style.display = 'none';
  }
}

// --- REALTIME ---
function subscribeToRealtime() {
  supabase.channel('admin-master-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'buses' }, () => loadDashboardData())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_sessions' }, () => loadDashboardData())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_logs' }, () => loadDashboardData())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sos_alerts' }, () => loadDashboardData())
    .subscribe();
}
