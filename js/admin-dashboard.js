// js/admin-dashboard.js

let busesData = [];
let driverSessions = [];

document.addEventListener('DOMContentLoaded', () => {
  loadDashboardData();
  subscribeToRealtime();
});

// --- LOAD DATA ---
async function loadDashboardData() {
  const [busesRes, sessionsRes] = await Promise.all([
    supabase.from('buses').select('*').order('bus_id'),
    supabase.from('driver_sessions').select('*')
  ]);

  if (busesRes.data) busesData = busesRes.data;
  if (sessionsRes.data) driverSessions = sessionsRes.data;

  renderBusTable();
}

// --- RENDER BUS TABLE ---
function renderBusTable() {
  const tbody = document.querySelector('#bus-table tbody');
  tbody.innerHTML = '';

  if (busesData.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;">No buses found. Add one!</td></tr>`;
    return;
  }

  busesData.forEach(bus => {
    // Check realtime status from driver_sessions
    const session = driverSessions.find(s => s.bus_id === bus.bus_id);
    const isOnline = session && session.is_online;
    
    const statusText = isOnline ? 'Active (Driving)' : 'Inactive';
    const statusClass = isOnline ? 'active' : 'inactive';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${bus.bus_id}</strong></td>
      <td>
        <div class="driver-assign-cell">
          <input
            type="text"
            class="driver-input"
            id="driver-input-${bus.bus_id}"
            placeholder="Enter driver name..."
            value="${bus.driver_name || ''}"
          />
          <button class="save-btn" onclick="saveDriver('${bus.bus_id}')">💾 Save</button>
          <button class="clear-btn" onclick="clearDriver('${bus.bus_id}')">✕ Clear</button>
        </div>
      </td>
      <td><span class="status-dot ${statusClass}"></span> ${statusText}</td>
      <td>
        <button class="btn btn-danger btn-sm" onclick="removeBus('${bus.bus_id}')">Remove</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// --- BUS MANAGEMENT ACTIONS ---
function openAddBusModal() {
  document.getElementById('addBusModal').classList.remove('hidden');
}

function closeAddBusModal() {
  document.getElementById('addBusModal').classList.add('hidden');
  document.getElementById('newBusId').value = '';
}

async function addNewBus() {
  const busId = document.getElementById('newBusId').value.trim();

  if (!busId) {
    alert('Bus ID cannot be empty!');
    return;
  }

  const { error } = await supabase
    .from('buses')
    .insert({
      bus_id: busId,
      status: 'inactive',
      driver_name: null
    });

  if (error) {
    alert('Error adding bus: ' + error.message);
  } else {
    alert(`${busId} added successfully!`);
    closeAddBusModal();
    loadDashboardData();
  }
}

async function removeBus(busId) {
  if (!confirm(`Are you sure you want to remove ${busId}?`)) return;
  
  // Cleanup sessions first to avoid foreign key issues
  await supabase.from('driver_sessions').delete().eq('bus_id', busId);
  
  const { error } = await supabase.from('buses').delete().eq('bus_id', busId);
  if (error) {
    alert("Failed to remove bus: " + error.message);
  } else {
    loadDashboardData();
  }
}

// --- DRIVER ASSIGNMENT ACTIONS ---
async function saveDriver(busId) {
  const input = document.getElementById(`driver-input-${busId}`);
  const name = input.value.trim();

  if (!name) {
    alert('Please enter a driver name before saving.');
    return;
  }

  const { error } = await supabase
    .from('buses')
    .update({ driver_name: name })
    .eq('bus_id', busId);

  if (error) {
    alert('Error saving driver: ' + error.message);
  } else {
    alert(`Driver "${name}" saved for ${busId}!`);
    loadDashboardData(); // Refresh UI
  }
}

async function clearDriver(busId) {
  if (!confirm(`Are you sure you want to remove the driver from ${busId}?`)) return;

  const { error } = await supabase
    .from('buses')
    .update({ driver_name: null })
    .eq('bus_id', busId);

  if (error) {
    alert('Error clearing driver: ' + error.message);
  } else {
    document.getElementById(`driver-input-${busId}`).value = '';
    alert(`Driver removed from ${busId}`);
    loadDashboardData();
  }
}

// --- REALTIME MONITORING ---
function subscribeToRealtime() {
  // Listen for realtime driver logins/logouts
  supabase.channel('admin-sessions-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_sessions' }, (payload) => {
      // Reload data to reflect new online/offline statuses
      loadDashboardData();
    })
    .subscribe();
}
