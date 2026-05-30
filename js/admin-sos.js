// js/admin-sos.js — Updated for premium dark UI

let resolvedToday = 0;

document.addEventListener('DOMContentLoaded', () => {
  loadSOSAlerts();
  subscribeToRealtime();
});

async function loadSOSAlerts() {
  const container = document.getElementById('alerts-container');

  try {
    const token = JSON.parse(localStorage.getItem('adminSession'))?.token;
    const res = await fetch(`${BACKEND_URL}/api/admin/sos-alerts`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) throw new Error('Failed to load alerts from backend');

    const data = await res.json();
    const alerts = data.data || [];

    // Deduplicate by bus_id, keep latest
    const uniqueAlerts = [];
    const seenBuses = new Set();
    alerts.forEach(alert => {
      if (!seenBuses.has(alert.bus_id)) {
        uniqueAlerts.push(alert);
        seenBuses.add(alert.bus_id);
      }
    });

    // Update stats
    document.getElementById('stat-active').textContent = uniqueAlerts.length;
    document.getElementById('stat-buses').textContent = uniqueAlerts.length > 0 ? uniqueAlerts.length : '0';
    document.getElementById('stat-resolved').textContent = resolvedToday;

    if (uniqueAlerts.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon-wrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
          </div>
          <h2>All Clear</h2>
          <p>No active emergency alerts. All buses are operating normally.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = '';

    uniqueAlerts.forEach(alert => {
      const card = document.createElement('div');
      card.className = 'sos-card';

      const d = new Date(alert.created_at);
      const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
      const dateStr = d.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });

      card.innerHTML = `
        <div class="card-header">
          <div class="card-header-left">
            <div class="bus-label">Emergency Alert</div>
            <div class="bus-id"></div>
            <div class="time-stamp"></div>
          </div>
          <div class="active-badge">
            <div class="pulse-ring"></div>
            SOS ACTIVE
          </div>
        </div>

        <div class="card-divider"></div>

        <div class="info-rows">
          <div class="info-row">
            <div class="info-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </div>
            <div class="info-content">
              <div class="info-label">Driver</div>
              <div class="info-value driver-name-val"></div>
            </div>
          </div>
          <div class="info-row">
            <div class="info-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
            </div>
            <div class="info-content">
              <div class="info-label">Last Known Location</div>
              <div class="info-value dimmed">GPS coordinates captured</div>
              <div class="map-link-wrap"></div>
            </div>
          </div>
        </div>

        <button class="btn-resolve">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          Mark as Resolved
        </button>
      `;

      // Safely set text content (prevents XSS)
      card.querySelector('.bus-id').textContent = alert.bus_id || 'Unknown Bus';
      card.querySelector('.time-stamp').textContent = `${timeStr} · ${dateStr}`;
      card.querySelector('.driver-name-val').textContent = alert.driver_name || 'N/A';

      // Map link
      if (alert.latitude && alert.longitude) {
        const mapLink = document.createElement('a');
        mapLink.href = `https://www.google.com/maps?q=${encodeURIComponent(alert.latitude)},${encodeURIComponent(alert.longitude)}`;
        mapLink.target = '_blank';
        mapLink.rel = 'noopener noreferrer';
        mapLink.className = 'map-btn';
        mapLink.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
          Open in Maps
        `;
        card.querySelector('.map-link-wrap').appendChild(mapLink);
      } else {
        card.querySelector('.info-value.dimmed').textContent = 'Location not available';
      }

      card.querySelector('.btn-resolve').addEventListener('click', () => resolveAlert(alert.bus_id));

      container.appendChild(card);
    });

  } catch (err) {
    console.error('[SOS] Load error:', err);
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon-wrap" style="background: rgba(255,59,92,0.1); border-color: rgba(255,59,92,0.2); color: var(--red);">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>
        </div>
        <h2>Connection Error</h2>
        <p>Could not load alerts. Check your connection and backend server.</p>
      </div>
    `;
  }
}

async function resolveAlert(busId) {
  if (!confirm(`Resolve the SOS alert for ${busId}?`)) return;

  const token = JSON.parse(localStorage.getItem('adminSession'))?.token;
  try {
    const res = await fetch(`${BACKEND_URL}/api/admin/sos-alerts/${busId}/resolve`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to resolve alert');
    }

    resolvedToday++;
    loadSOSAlerts();
  } catch (e) {
    alert('Error resolving alert: ' + e.message);
  }
}

function subscribeToRealtime() {
  if (!window.supabase) return;
  supabase.channel('admin-sos-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sos_alerts' }, () => {
      loadSOSAlerts();
    })
    .subscribe();
}
