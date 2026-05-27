// js/admin-dashboard.js

let busesData = [];
let driverSessions = [];
let adminLogs = [];
let sosAlerts = [];
let adminUsername = 'Admin';
let editingDriverForBusId = null; // Tracks which bus row is currently in inline-edit mode

document.addEventListener('DOMContentLoaded', () => {
  const session = JSON.parse(localStorage.getItem('adminSession'));
  if (session) adminUsername = session.username;

  loadDashboardData();
  subscribeToRealtime();
  setupFileInputListeners();
});

function setupFileInputListeners() {
  document.getElementById('inpBusPhoto').addEventListener('change', function(e) {
    handleFileInputChange(e.target, 'busPhotoPreview', 'btnRemoveBusPhoto');
  });
  document.getElementById('inpDriverPhoto').addEventListener('change', function(e) {
    handleFileInputChange(e.target, 'driverPhotoPreview', 'btnRemoveDriverPhoto');
  });
}

function handleFileInputChange(input, previewId, removeBtnId) {
  const file = input.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = function(e) {
      document.getElementById(previewId).src = e.target.result;
      document.getElementById(previewId).style.display = 'block';
      document.getElementById(removeBtnId).style.display = 'inline-block';
    }
    reader.readAsDataURL(file);
  } else {
    document.getElementById(previewId).style.display = 'none';
    document.getElementById(removeBtnId).style.display = 'none';
  }
}

// --- LOAD DATA ---
async function loadDashboardData() {
  const [busesRes, sessionsRes, logsRes, sosRes] = await Promise.all([
    supabase.from('buses').select('*').order('id'),
    supabase.from('driver_sessions').select('*'),
    supabase.from('admin_logs').select('*').order('created_at', { ascending: false }).limit(50),
    supabase.from('sos_alerts').select('*').eq('status', 'active')
  ]);

  if (busesRes.data) busesData = busesRes.data;
  if (sessionsRes.data) driverSessions = sessionsRes.data;
  if (logsRes.data) adminLogs = logsRes.data;
  if (sosRes.data) sosAlerts = sosRes.data;

  renderBusTable();
  renderAdminLogs();
  checkSOSAlerts();
}

// --- RENDER BUS TABLE ---
function renderBusTable() {
  const tbody = document.getElementById('bus-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  // Search filtering
  const searchTerm = (document.getElementById('filterFleet').value || '').toLowerCase();

  const filteredBuses = busesData.filter(b => 
    (b.id || '').toLowerCase().includes(searchTerm) || 
    (b.driver_name || '').toLowerCase().includes(searchTerm) ||
    (b.route_name || '').toLowerCase().includes(searchTerm)
  );

  if (filteredBuses.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 40px; color: #888;">No buses found. Add one to get started!</td></tr>`;
    return;
  }

  filteredBuses.forEach(bus => {
    const session = driverSessions.find(s => s.bus_id === bus.id);
    const isOnline = session && session.is_online;
    
    // Status Logic
    let statusText = 'Offline';
    let statusClass = 'offline';
    
    if (isOnline) {
      statusText = 'Active';
      statusClass = 'active';
    } else if (session) {
      // If there is a session but not online, maybe Idle? Let's say if they were seen in last hour it's Idle
      const mins = Math.round((new Date() - new Date(session.last_seen)) / 60000);
      if (mins < 60) {
        statusText = 'Idle';
        statusClass = 'idle';
      }
    }
    
    let lastSeenStr = '';
    if (!isOnline && session && session.last_seen) {
      const mins = Math.round((new Date() - new Date(session.last_seen)) / 60000);
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

      lastSeenStr = `<span style="font-size: 11px; color:#9ca3af; margin-left: 8px;">(Last active: ${formattedTime})</span>`;
    }

    const tr = document.createElement('tr');
    
    // Inline editing logic for driver
    let driverCellHtml = '';
    if (editingDriverForBusId === bus.id) {
      driverCellHtml = `
        <input type="text" class="inline-input" id="inlineDriver_${bus.id}" value="${bus.driver_name || ''}" placeholder="Enter driver name">
        <button class="btn-inline-save" onclick="saveInlineDriver('${bus.id}')">Save Changes</button>
      `;
    } else {
      driverCellHtml = `
        <div class="driver-name-display" onclick="enableInlineEdit('${bus.id}')">
          ${bus.driver_name || '<span style="color:#9ca3af; font-style:italic;">No driver assigned</span>'}
          <i class="fas fa-pen"></i>
        </div>
      `;
    }

    const localBusPhoto = localStorage.getItem(`bus_photo_${bus.id}`) || bus.bus_photo_url;
    tr.innerHTML = `
      <td>
        <div style="display:flex; align-items:center; gap: 12px;">
          ${localBusPhoto ? `<img src="${localBusPhoto}" style="width:40px; height:40px; border-radius:8px; object-fit:cover;">` : ''}
          <span>${bus.id}</span>
        </div>
      </td>
      <td>
        ${driverCellHtml}
      </td>
      <td>
        <div class="status-cell">
          <div class="status-dot ${statusClass}"></div> 
          <span style="text-transform: capitalize;">${statusText}</span>
          ${lastSeenStr}
        </div>
      </td>
      <td>
        <div class="actions-cell">
          <button class="btn-remove" onclick="deleteBus('${bus.id}')">Remove</button>
          <button class="btn-edit-row" onclick="openMasterModal('${bus.id}')"><i class="fas fa-cog"></i></button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function filterBuses() {
  renderBusTable();
}

// --- INLINE EDITING ---
function enableInlineEdit(busId) {
  editingDriverForBusId = busId;
  renderBusTable();
  // Focus the input
  setTimeout(() => {
    const input = document.getElementById(`inlineDriver_${busId}`);
    if (input) input.focus();
  }, 50);
}

async function saveInlineDriver(busId) {
  const input = document.getElementById(`inlineDriver_${busId}`);
  if (!input) return;
  const newName = input.value.trim();

  // Update Supabase
  const { error } = await supabase.from('buses').update({ driver_name: newName }).eq('id', busId);
  if (error) {
    alert("Error updating driver: " + error.message);
  } else {
    await logAdminAction(`Updated assigned driver for ${busId} to "${newName}"`);
    editingDriverForBusId = null; // Exit edit mode
    loadDashboardData(); // Refetch and re-render
  }
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
  document.getElementById('busPhotoPreview').style.display = 'none';
  document.getElementById('btnRemoveBusPhoto').style.display = 'none';
  document.getElementById('inpDriverPhoto').value = '';
  document.getElementById('driverPhotoPreview').style.display = 'none';
  document.getElementById('btnRemoveDriverPhoto').style.display = 'none';
  document.getElementById('inpDriverName').value = '';
  document.getElementById('inpDriverPhone').value = '';
  document.getElementById('inpDriverUser').value = '';
  document.getElementById('inpDriverPass').value = '';

  if (busId) {
    document.getElementById('modalTitle').innerText = `Edit ${busId}`;
    document.getElementById('isNewBus').value = 'false';
    document.getElementById('editBusId').value = busId;
    document.getElementById('inpBusName').disabled = true;
    
    const bus = busesData.find(b => b.id === busId);
    if (bus) {
      document.getElementById('inpBusName').value = bus.id;
      document.getElementById('inpRoute').value = bus.route_name || '';
      document.getElementById('inpPlate').value = bus.number_plate || '';
      document.getElementById('inpDriverName').value = bus.driver_name || '';
      document.getElementById('inpDriverPhone').value = bus.driver_phone || '';
    }

    const busPhotoUrl = localStorage.getItem(`bus_photo_${busId}`) || (bus && bus.bus_photo_url);
    if (busPhotoUrl) {
      document.getElementById('busPhotoPreview').src = busPhotoUrl;
      document.getElementById('busPhotoPreview').style.display = 'block';
      document.getElementById('btnRemoveBusPhoto').style.display = 'inline-block';
    }
    const driverPhotoUrl = localStorage.getItem(`driver_photo_${busId}`) || (bus && bus.driver_photo_url);
    if (driverPhotoUrl) {
      document.getElementById('driverPhotoPreview').src = driverPhotoUrl;
      document.getElementById('driverPhotoPreview').style.display = 'block';
      document.getElementById('btnRemoveDriverPhoto').style.display = 'inline-block';
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
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function removePhoto(type) {
  const busId = document.getElementById('editBusId').value;
  if (!busId) {
    if (type === 'bus') {
      document.getElementById('inpBusPhoto').value = '';
      document.getElementById('busPhotoPreview').style.display = 'none';
      document.getElementById('btnRemoveBusPhoto').style.display = 'none';
      // If there was an existing photo in localStorage, revert to showing it? 
      // No, they clicked trash, we should remove it permanently.
    } else {
      document.getElementById('inpDriverPhoto').value = '';
      document.getElementById('driverPhotoPreview').style.display = 'none';
      document.getElementById('btnRemoveDriverPhoto').style.display = 'none';
    }
    return;
  }
  
  const hasLocalPhoto = localStorage.getItem(`${type}_photo_${busId}`);
  const bus = busesData.find(b => b.id === busId);
  const hasDbPhoto = bus && (type === 'bus' ? bus.bus_photo_url : bus.driver_photo_url);

  if (!hasLocalPhoto && !hasDbPhoto) {
    if (type === 'bus') {
      document.getElementById('inpBusPhoto').value = '';
      document.getElementById('busPhotoPreview').style.display = 'none';
      document.getElementById('btnRemoveBusPhoto').style.display = 'none';
    } else {
      document.getElementById('inpDriverPhoto').value = '';
      document.getElementById('driverPhotoPreview').style.display = 'none';
      document.getElementById('btnRemoveDriverPhoto').style.display = 'none';
    }
    return;
  }

  if (confirm(`Are you sure you want to delete this ${type} photo permanently?`)) {
    localStorage.removeItem(`${type}_photo_${busId}`);
    if (type === 'bus') {
      supabase.from('buses').update({ bus_photo_url: null }).eq('id', busId).then();
      document.getElementById('inpBusPhoto').value = '';
      document.getElementById('busPhotoPreview').style.display = 'none';
      document.getElementById('btnRemoveBusPhoto').style.display = 'none';
    } else {
      supabase.from('buses').update({ driver_photo_url: null }).eq('id', busId).then();
      document.getElementById('inpDriverPhoto').value = '';
      document.getElementById('driverPhotoPreview').style.display = 'none';
      document.getElementById('btnRemoveDriverPhoto').style.display = 'none';
    }
    loadDashboardData();
  }
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

    if (busFile) {
      const dataUrl = await fileToDataUrl(busFile);
      localStorage.setItem(`bus_photo_${busId}`, dataUrl);
    }
    if (driverFile) {
      const dataUrl = await fileToDataUrl(driverFile);
      localStorage.setItem(`driver_photo_${busId}`, dataUrl);
    }

    const busPayload = {
      route_name: document.getElementById('inpRoute').value.trim(),
      number_plate: document.getElementById('inpPlate').value.trim(),
      driver_name: document.getElementById('inpDriverName').value.trim(),
      driver_phone: document.getElementById('inpDriverPhone').value.trim()
    };

    if (isNew) {
      busPayload.id = busId;
      const { error: busErr } = await supabase.from('buses').insert(busPayload);
      if (busErr) throw new Error("Insert Error: " + busErr.message);
      await logAdminAction(`Added new bus: ${busId}`);
    } else {
      const { error: busErr } = await supabase.from('buses').update(busPayload).eq('id', busId);
      if (busErr) throw new Error("Update Error: " + busErr.message);
      await logAdminAction(`Updated details for bus: ${busId}`);
    }

    // Driver Credentials
    const username = document.getElementById('inpDriverUser').value.trim();
    const password = document.getElementById('inpDriverPass').value.trim();

    if (username) {
      const driverPayload = { username: username, assigned_bus: busId, driver_name: busPayload.driver_name };
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
  if (!confirm(`Are you absolutely sure you want to remove ${busId}? This will remove driver assignments as well.`)) return;
  await supabase.from('driver_sessions').delete().eq('bus_id', busId);
  await supabase.from('drivers').update({ assigned_bus: null }).eq('assigned_bus', busId);
  await supabase.from('buses').delete().eq('id', busId);
  localStorage.removeItem(`bus_photo_${busId}`);
  localStorage.removeItem(`driver_photo_${busId}`);
  await logAdminAction(`Removed bus: ${busId}`);
  loadDashboardData();
}

// --- ADMIN LOGS ---
async function clearAdminLogs() {
  if (!confirm("Are you sure you want to clear all admin logs?")) return;
  const { error } = await supabase.from('admin_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (error) {
    alert("Error clearing logs: " + error.message);
  } else {
    adminLogs = [];
    renderAdminLogs();
  }
}

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
  const badge = document.getElementById('sos-badge');
  if (!badge) return;
  
  const uniqueBuses = [...new Set(sosAlerts.map(s => s.bus_id))];
  if (uniqueBuses.length > 0) {
    badge.style.display = 'block';
    badge.innerText = uniqueBuses.length;
  } else {
    badge.style.display = 'none';
  }
}

// --- REALTIME ---
function subscribeToRealtime() {
  supabase.channel('admin-master-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'buses' }, () => {
      // Don't auto-reload data if currently inline editing, could lose focus
      if (!editingDriverForBusId) loadDashboardData();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_sessions' }, () => {
      if (!editingDriverForBusId) loadDashboardData();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_logs' }, () => {
      if (!editingDriverForBusId) loadDashboardData();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sos_alerts' }, () => {
      if (!editingDriverForBusId) loadDashboardData();
    })
    .subscribe();
}
