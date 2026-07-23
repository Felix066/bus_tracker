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

  updateStatsCards();
  renderBusTable();
  renderAdminLogs();
  checkSOSAlerts();
}

function updateStatsCards() {
  if (document.getElementById('stat-total-buses')) {
    document.getElementById('stat-total-buses').innerText = busesData.length;
    
    const activeDriversCount = driverSessions.filter(s => {
      const mins = Math.round((new Date() - new Date(s.last_seen)) / 60000);
      return s.is_online && mins <= 5;
    }).length;
    
    document.getElementById('stat-active-drivers').innerText = activeDriversCount;
    
    const uniqueRoutes = new Set(busesData.map(b => b.route_name).filter(Boolean));
    document.getElementById('stat-routes').innerText = uniqueRoutes.size;
  }
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
    let statusClass = 'status-offline';
    let lastSeenStr = '';
    
    if (session) {
      const mins = Math.round((new Date() - new Date(session.last_seen)) / 60000);
      
      if (isOnline && mins <= 5) {
        statusText = 'Active';
        statusClass = 'status-active';
      } else if (mins < 60) {
        statusText = 'Idle';
        statusClass = 'status-idle';
      }
      
      if (session.last_seen && (statusText !== 'Active')) {
        let formattedTime = '';
        const hours = Math.floor(mins / 60);
        const days = Math.floor(hours / 24);
        const months = Math.floor(days / 30);
        const years = Math.floor(days / 365);
        
        if (years > 0) formattedTime = `${years}y ago`;
        else if (months > 0) formattedTime = `${months}mo ago`;
        else if (days > 0) formattedTime = `${days}d ago`;
        else if (hours > 0) formattedTime = `${hours}h ago`;
        else formattedTime = `${mins}m ago`;

        if (formattedTime) {
          lastSeenStr = '(' + formattedTime + ')';
        }
      }
    }

    const tr = document.createElement('tr');
    
    const localBusPhoto = localStorage.getItem(`bus_photo_${bus.id}`) || bus.bus_photo_url;

    // Cell 1
    const td1 = document.createElement('td');
    const div1 = document.createElement('div');
    div1.className = 'bus-id-cell';
    if (localBusPhoto) {
      const img = document.createElement('img');
      img.src = localBusPhoto;
      img.style.width = '40px';
      img.style.height = '40px';
      img.style.borderRadius = '10px';
      img.style.objectFit = 'cover';
      div1.appendChild(img);
    } else {
      const busIcon = document.createElement('div');
      busIcon.className = 'bus-icon';
      busIcon.innerHTML = '<i class="fas fa-bus"></i>';
      div1.appendChild(busIcon);
    }
    const idInfo = document.createElement('div');
    const idSpan = document.createElement('div');
    idSpan.style.fontWeight = '700';
    idSpan.textContent = bus.id;
    const routeSpan = document.createElement('div');
    routeSpan.style.fontSize = '12px';
    routeSpan.style.color = 'var(--text-muted)';
    routeSpan.style.marginTop = '2px';
    routeSpan.textContent = bus.route_name || 'No Route';
    idInfo.appendChild(idSpan);
    idInfo.appendChild(routeSpan);
    div1.appendChild(idInfo);
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
      btn.textContent = 'Save';
      btn.onclick = () => saveInlineDriver(bus.id);
      td2.appendChild(input);
      td2.appendChild(btn);
    } else {
      const div2 = document.createElement('div');
      div2.className = 'driver-name-display';
      div2.onclick = () => enableInlineEdit(bus.id);
      
      const localDriverPhoto = localStorage.getItem(`driver_photo_${bus.id}`) || bus.driver_photo_url;
      if (localDriverPhoto) {
        const dImg = document.createElement('img');
        dImg.src = localDriverPhoto;
        dImg.style.width = '24px';
        dImg.style.height = '24px';
        dImg.style.borderRadius = '50%';
        dImg.style.objectFit = 'cover';
        dImg.style.marginRight = '8px';
        div2.appendChild(dImg);
      } else {
        const dIcon = document.createElement('i');
        dIcon.className = 'fas fa-user-circle';
        dIcon.style.marginRight = '8px';
        dIcon.style.color = 'var(--text-muted)';
        dIcon.style.opacity = '1';
        dIcon.style.fontSize = '16px';
        div2.appendChild(dIcon);
      }
      
      if (bus.driver_name) {
        const dName = document.createElement('span');
        dName.textContent = bus.driver_name;
        div2.appendChild(dName);
      } else {
        const spanEmpty = document.createElement('span');
        spanEmpty.style.color = 'var(--text-muted)';
        spanEmpty.style.fontStyle = 'italic';
        spanEmpty.textContent = 'Unassigned';
        div2.appendChild(spanEmpty);
      }
      const iPen = document.createElement('i');
      iPen.className = 'fas fa-pen';
      div2.appendChild(iPen);
      td2.appendChild(div2);
    }
    tr.appendChild(td2);

    // Phone Cell
    const tdPhone = document.createElement('td');
    tdPhone.style.fontSize = '13px';
    tdPhone.style.color = 'var(--text-muted)';
    if (bus.driver_phone) {
      tdPhone.textContent = bus.driver_phone;
    } else {
      tdPhone.textContent = 'Not Provided';
      tdPhone.style.fontStyle = 'italic';
    }
    tr.appendChild(tdPhone);

    // Cell 3
    const td3 = document.createElement('td');
    const pill = document.createElement('div');
    pill.className = 'status-pill ' + statusClass;
    const dot = document.createElement('div');
    dot.className = 'dot';
    const spanStatus = document.createElement('span');
    spanStatus.textContent = statusText;
    pill.appendChild(dot);
    pill.appendChild(spanStatus);
    if (lastSeenStr) {
      const spanLast = document.createElement('span');
      spanLast.style.fontSize = '10px';
      spanLast.style.opacity = '0.8';
      spanLast.style.marginLeft = '4px';
      spanLast.textContent = lastSeenStr;
      pill.appendChild(spanLast);
    }
    td3.appendChild(pill);
    tr.appendChild(td3);

    // Cell 4
    const td4 = document.createElement('td');
    td4.style.textAlign = 'right';
    const div4 = document.createElement('div');
    div4.className = 'actions-cell';
    div4.style.justifyContent = 'flex-end';
    
    const btnEdit = document.createElement('button');
    btnEdit.className = 'btn-icon btn-edit-row';
    btnEdit.title = 'Edit Bus Details';
    btnEdit.onclick = () => openMasterModal(bus.id);
    const iCog = document.createElement('i');
    iCog.className = 'fas fa-cog';
    btnEdit.appendChild(iCog);
    
    const btnRem = document.createElement('button');
    btnRem.className = 'btn-icon btn-remove';
    btnRem.title = 'Remove Bus';
    btnRem.onclick = () => deleteBus(bus.id);
    const iTrash = document.createElement('i');
    iTrash.className = 'fas fa-trash';
    btnRem.appendChild(iTrash);
    
    div4.appendChild(btnEdit);
    div4.appendChild(btnRem);
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
    const token = JSON.parse(localStorage.getItem('adminSession'))?.token;
    if (type === 'bus') {
      fetch(`${BACKEND_URL}/api/admin/buses`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ id: busId, isNew: false, busPayload: { bus_photo_url: null } }) });
      document.getElementById('inpBusPhoto').value = '';
      document.getElementById('busPhotoPreview').style.display = 'none';
      document.getElementById('btnRemoveBusPhoto').style.display = 'none';
    } else {
      fetch(`${BACKEND_URL}/api/admin/buses`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ id: busId, isNew: false, busPayload: { driver_photo_url: null } }) });
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

    const MAX_SIZE = 5 * 1024 * 1024; // 5MB
    if (busFile && busFile.size > MAX_SIZE) {
      throw new Error("Bus photo is too large. Maximum size is 5MB.");
    }
    if (driverFile && driverFile.size > MAX_SIZE) {
      throw new Error("Driver photo is too large. Maximum size is 5MB.");
    }

    let busDataUrl = localStorage.getItem(`bus_photo_${busId}`);
    let driverDataUrl = localStorage.getItem(`driver_photo_${busId}`);

    if (busFile) {
      busDataUrl = await fileToDataUrl(busFile);
      try {
        localStorage.setItem(`bus_photo_${busId}`, busDataUrl);
      } catch (e) {
        console.warn("Could not save bus photo to localStorage (quota exceeded).");
      }
    }
    if (driverFile) {
      driverDataUrl = await fileToDataUrl(driverFile);
      try {
        localStorage.setItem(`driver_photo_${busId}`, driverDataUrl);
      } catch (e) {
        console.warn("Could not save driver photo to localStorage (quota exceeded).");
      }
    }

    const busPayload = {
      route_name: document.getElementById('inpRoute').value.trim(),
      number_plate: document.getElementById('inpPlate').value.trim(),
      driver_name: document.getElementById('inpDriverName').value.trim(),
      driver_phone: document.getElementById('inpDriverPhone').value.trim()
    };
    
    // Add photos to payload if they exist so they save to the database
    if (busDataUrl) busPayload.bus_photo_url = busDataUrl;
    if (driverDataUrl) busPayload.driver_photo_url = driverDataUrl;

    const token = JSON.parse(localStorage.getItem('adminSession'))?.token;
    const busRes = await fetch(`${BACKEND_URL}/api/admin/buses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ id: busId, isNew, busPayload })
    });

    if (!busRes.ok) {
      let errorMsg = "An unknown error occurred during save.";
      try {
        const errData = await busRes.json();
        errorMsg = errData.error;
      } catch (parseErr) {
        if (busRes.status === 413) errorMsg = "The uploaded photos are too large for the server to process.";
        else errorMsg = `Server returned status ${busRes.status}`;
      }
      throw new Error("Save Error: " + errorMsg);
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
    span2.className = 'log-time';
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
