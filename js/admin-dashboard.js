// js/admin-dashboard.js

function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

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
  const token = JSON.parse(localStorage.getItem('adminSession'))?.token;
  if (!token) return;

  try {
    const res = await fetch(`${BACKEND_URL}/api/admin/dashboard-data`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        busesData = data.buses || [];
        driverSessions = data.sessions || [];
        adminLogs = data.logs || [];
        sosAlerts = data.sosAlerts || [];
      }
    }
  } catch (err) {
    console.warn("Failed to load dashboard data from backend", err);
  }

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

      if (formattedTime) {
        lastSeenStr = '(Last active: ' + formattedTime + ')';
      }
    }

    const tr = document.createElement('tr');
    
    const localBusPhoto = localStorage.getItem(`bus_photo_${bus.id}`) || bus.bus_photo_url;

    // Cell 1
    const td1 = document.createElement('td');
    const div1 = document.createElement('div');
    div1.style.display = 'flex';
    div1.style.alignItems = 'center';
    div1.style.gap = '12px';
    if (localBusPhoto) {
      const img = document.createElement('img');
      img.src = localBusPhoto;
      img.style.width = '40px';
      img.style.height = '40px';
      img.style.borderRadius = '8px';
      img.style.objectFit = 'cover';
      div1.appendChild(img);
    }
    const span1 = document.createElement('span');
    span1.textContent = bus.id;
    div1.appendChild(span1);
    td1.appendChild(div1);
    tr.appendChild(td1);

    // Cell 2
    const td2 = document.createElement('td');
    if (editingDriverForBusId === bus.id) {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'inline-input';
      input.id = 'inlineDriver_' + bus.id;
      input.value = bus.driver_name || '';
      input.placeholder = 'Enter driver name';
      const btn = document.createElement('button');
      btn.className = 'btn-inline-save';
      btn.textContent = 'Save Changes';
      btn.onclick = () => saveInlineDriver(bus.id);
      td2.appendChild(input);
      td2.appendChild(btn);
    } else {
      const div2 = document.createElement('div');
      div2.className = 'driver-name-display';
      div2.onclick = () => enableInlineEdit(bus.id);
      if (bus.driver_name) {
        div2.appendChild(document.createTextNode(bus.driver_name + ' '));
      } else {
        const spanEmpty = document.createElement('span');
        spanEmpty.style.color = '#9ca3af';
        spanEmpty.style.fontStyle = 'italic';
        spanEmpty.textContent = 'No driver assigned ';
        div2.appendChild(spanEmpty);
      }
      const iPen = document.createElement('i');
      iPen.className = 'fas fa-pen';
      div2.appendChild(iPen);
      td2.appendChild(div2);
    }
    tr.appendChild(td2);

    // Cell 3
    const td3 = document.createElement('td');
    const div3 = document.createElement('div');
    div3.className = 'status-cell';
    const dot = document.createElement('div');
    dot.className = 'status-dot ' + statusClass;
    const spanStatus = document.createElement('span');
    spanStatus.style.textTransform = 'capitalize';
    spanStatus.textContent = statusText;
    div3.appendChild(dot);
    div3.appendChild(spanStatus);
    if (lastSeenStr) {
      const spanLast = document.createElement('span');
      spanLast.style.fontSize = '11px';
      spanLast.style.color = '#9ca3af';
      spanLast.style.marginLeft = '8px';
      spanLast.textContent = lastSeenStr;
      div3.appendChild(spanLast);
    }
    td3.appendChild(div3);
    tr.appendChild(td3);

    // Cell 4
    const td4 = document.createElement('td');
    const div4 = document.createElement('div');
    div4.className = 'actions-cell';
    const btnRem = document.createElement('button');
    btnRem.className = 'btn-remove';
    btnRem.textContent = 'Remove';
    btnRem.onclick = () => deleteBus(bus.id);
    const btnEdit = document.createElement('button');
    btnEdit.className = 'btn-edit-row';
    btnEdit.onclick = () => openMasterModal(bus.id);
    const iCog = document.createElement('i');
    iCog.className = 'fas fa-cog';
    btnEdit.appendChild(iCog);
    div4.appendChild(btnRem);
    div4.appendChild(btnEdit);
    td4.appendChild(div4);
    tr.appendChild(td4);
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

  // Update via backend API
  const token = JSON.parse(localStorage.getItem('adminSession'))?.token;
  const res = await fetch(`${BACKEND_URL}/api/admin/buses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ id: busId, isNew: false, busPayload: { driver_name: newName } })
  });
  
  if (!res.ok) {
    const errData = await res.json();
    alert("Error updating driver: " + errData.error);
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

    const token = JSON.parse(localStorage.getItem('adminSession'))?.token;
    const busRes = await fetch(`${BACKEND_URL}/api/admin/buses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ id: busId, isNew, busPayload })
    });

    if (!busRes.ok) {
      const errData = await busRes.json();
      throw new Error("Save Error: " + errData.error);
    }

    if (isNew) {
      await logAdminAction(`Added new bus: ${busId}`);
    } else {
      await logAdminAction(`Updated details for bus: ${busId}`);
    }

    // Driver Credentials
    const username = document.getElementById('inpDriverUser').value.trim();
    const password = document.getElementById('inpDriverPass').value.trim();

    if (username) {
      if (!isNew && !password) {
        // If it's not a new bus and no password provided, just update driver assignment 
        // using the backend or directly if allowed, but wait, the RLS will block direct edits of drivers.
        // For security, all driver credential management goes through the backend API.
      }
      
      if (password) {
        // Register driver via secure backend API
        const token = JSON.parse(localStorage.getItem('adminSession'))?.token;
        const driverRes = await fetch(`${BACKEND_URL}/api/auth/register-driver`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ username, password, busId })
        });
        
        if (!driverRes.ok) {
          const errData = await driverRes.json();
          console.warn("Driver creation issue:", errData.error);
        }
      }
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
  const token = JSON.parse(localStorage.getItem('adminSession'))?.token;
  const res = await fetch(`${BACKEND_URL}/api/admin/buses/${busId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) {
    const errData = await res.json();
    alert("Error deleting bus: " + errData.error);
    return;
  }
  localStorage.removeItem(`bus_photo_${busId}`);
  localStorage.removeItem(`driver_photo_${busId}`);
  await logAdminAction(`Removed bus: ${busId}`);
  loadDashboardData();
}

// --- ADMIN LOGS ---
async function clearAdminLogs() {
  if (!confirm("Are you sure you want to clear all admin logs?")) return;
  const token = JSON.parse(localStorage.getItem('adminSession'))?.token;
  const res = await fetch(`${BACKEND_URL}/api/admin/logs`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) {
    const errData = await res.json();
    alert("Error clearing logs: " + errData.error);
  } else {
    adminLogs = [];
    renderAdminLogs();
  }
}

async function logAdminAction(actionText) {
  const token = JSON.parse(localStorage.getItem('adminSession'))?.token;
  await fetch(`${BACKEND_URL}/api/admin/logs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ action_text: actionText })
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
    
    const span1 = document.createElement('span');
    span1.className = 'log-action';
    const strong = document.createElement('strong');
    strong.textContent = log.admin_username;
    span1.appendChild(strong);
    span1.appendChild(document.createTextNode(': ' + log.action_text));
    
    const span2 = document.createElement('span');
    span2.textContent = d.toLocaleDateString() + ' ' + timeStr;
    
    div.appendChild(span1);
    div.appendChild(span2);
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
  if (!window.supabase) return;
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
