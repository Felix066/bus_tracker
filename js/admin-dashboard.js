// js/admin-dashboard.js

let map;
let busMarkers = {};
let driversData = [];
let busesData = [];

document.addEventListener('DOMContentLoaded', () => {
  initAdminMap();
  loadDashboardData();
  subscribeToRealtime();
});

// --- INIT MAP ---
function initAdminMap() {
  map = L.map('map').setView([9.317537, 76.615136], 13); // Default view
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap © CARTO'
  }).addTo(map);
}

// --- LOAD DATA ---
async function loadDashboardData() {
  const [driversRes, busesRes] = await Promise.all([
    supabase.from('drivers').select('id, driver_name, username, assigned_bus').order('driver_name'),
    supabase.from('buses').select('id, driver_id, status').order('id')
  ]);

  if (driversRes.data) driversData = driversRes.data;
  if (busesRes.data) busesData = busesRes.data;

  renderBusTable();
  renderDriverTable();
  updateActiveTripsCount();
}

// --- RENDER BUS TABLE ---
function renderBusTable() {
  const tbody = document.querySelector('#bus-table tbody');
  tbody.innerHTML = '';

  busesData.forEach(bus => {
    // Find driver assigned to this bus
    const assignedDriver = driversData.find(d => d.id === bus.driver_id) || driversData.find(d => d.assigned_bus === bus.id);
    const driverName = assignedDriver ? assignedDriver.driver_name : 'Unassigned';
    
    // Select options for assignment
    let driverOptions = `<option value="">-- Unassigned --</option>`;
    driversData.forEach(d => {
      const selected = (assignedDriver && assignedDriver.id === d.id) ? 'selected' : '';
      driverOptions += `<option value="${d.id}" ${selected}>${d.driver_name} (${d.username})</option>`;
    });

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${bus.id}</strong></td>
      <td>
        <select onchange="assignDriver('${bus.id}', this.value)">
          ${driverOptions}
        </select>
      </td>
      <td><span class="status-dot ${bus.status === 'active' ? 'active' : 'inactive'}"></span> ${bus.status}</td>
      <td>
        <button class="btn btn-danger btn-sm" onclick="removeBus('${bus.id}')">Remove</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// --- RENDER DRIVER TABLE ---
function renderDriverTable() {
  const tbody = document.querySelector('#driver-table tbody');
  tbody.innerHTML = '';

  driversData.forEach(driver => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div style="display:flex; gap:5px; align-items:center;">
          <input type="text" id="name-${driver.id}" value="${driver.driver_name || ''}" style="width:100px;">
          <button class="btn btn-primary btn-sm" onclick="saveDriverName('${driver.id}')">Save</button>
        </div>
      </td>
      <td>${driver.username}</td>
      <td>${driver.assigned_bus || 'None'}</td>
      <td>
        <button class="btn btn-primary btn-sm" onclick="resetPassword('${driver.username}')">Reset Password</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// --- BUS MANAGEMENT ACTIONS ---
async function showAddBus() {
  const busId = prompt("Enter new Bus ID (e.g., 'Bus 7'):");
  if (!busId) return;

  const { error } = await supabase.from('buses').insert({ id: busId, status: 'active' });
  if (error) {
    alert("Error adding bus: " + error.message);
  } else {
    loadDashboardData();
  }
}

async function removeBus(busId) {
  if (!confirm(`Are you sure you want to remove ${busId}?`)) return;
  
  // Detach driver first (buses.driver_id is ON DELETE SET NULL, but we also update drivers table)
  await supabase.from('drivers').update({ assigned_bus: null }).eq('assigned_bus', busId);
  await supabase.from('buses').delete().eq('id', busId);
  loadDashboardData();
}

async function assignDriver(busId, driverId) {
  // Clear old assignments for this bus
  await supabase.from('drivers').update({ assigned_bus: null }).eq('assigned_bus', busId);
  await supabase.from('buses').update({ driver_id: driverId || null }).eq('id', busId);
  
  if (driverId) {
    await supabase.from('drivers').update({ assigned_bus: busId }).eq('id', driverId);
  }
  loadDashboardData();
}

// --- DRIVER MANAGEMENT ACTIONS ---
async function saveDriverName(driverId) {
  const newName = document.getElementById(`name-${driverId}`).value;
  const { error } = await supabase.from('drivers').update({ driver_name: newName }).eq('id', driverId);
  if (error) {
    alert("Failed to update name: " + error.message);
  } else {
    alert("Driver name saved!");
    loadDashboardData();
  }
}

async function resetPassword(username) {
  const newPass = prompt(`Enter new plain text password for ${username}:`);
  if (!newPass) return;

  // In the real system, driver passwords are plain text 
  const { error } = await supabase.from('drivers').update({ password_hash: newPass }).eq('username', username);
  if (error) {
    alert("Failed to reset password: " + error.message);
  } else {
    alert("Password reset successfully.");
  }
}

// --- REALTIME MONITORING ---
let activeTripsCount = 0;

async function updateActiveTripsCount() {
  const { count } = await supabase.from('trips').select('id', { count: 'exact' }).eq('status', 'active');
  activeTripsCount = count || 0;
  document.getElementById('active-trips-count').textContent = `${activeTripsCount} Active Trips`;
}

function subscribeToRealtime() {
  // Listen for trips changing
  supabase.channel('admin-trips-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, () => {
      updateActiveTripsCount();
    })
    .subscribe();

  // Listen for bus locations
  supabase.channel('admin-locations-live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'computed_locations' }, (payload) => {
      updateAdminMap(payload.new);
    })
    .subscribe();
}

function updateAdminMap(loc) {
  const { bus_id, latitude, longitude } = loc;
  
  // Custom simple circle marker for admin view (lightweight)
  if (!busMarkers[bus_id]) {
    busMarkers[bus_id] = L.circleMarker([latitude, longitude], {
      color: '#3b82f6',
      fillColor: '#60a5fa',
      fillOpacity: 1,
      radius: 8
    }).addTo(map).bindTooltip(bus_id, { permanent: true, direction: 'top', className: 'admin-bus-tooltip' });
  } else {
    busMarkers[bus_id].setLatLng([latitude, longitude]);
  }
}
