// js/admin-sos.js — Embedded inline chat per SOS card

let resolvedToday = 0;
// Map of busId -> polling interval ID
const chatPolls = {};

function initResolvedCounter() {
  const storedDate = localStorage.getItem('sos_resolved_date');
  const today = new Date().toDateString();
  if (storedDate === today) {
    resolvedToday = parseInt(localStorage.getItem('sos_resolved_count') || '0', 10);
  } else {
    resolvedToday = 0;
    localStorage.setItem('sos_resolved_date', today);
    localStorage.setItem('sos_resolved_count', '0');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initResolvedCounter();
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
    document.getElementById('stat-resolved').textContent = resolvedToday;

    if (uniqueAlerts.length === 0) {
      // Clear all polls
      Object.values(chatPolls).forEach(id => clearInterval(id));
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon-wrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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
      card.dataset.busId = alert.bus_id;

      const d = new Date(alert.created_at);
      const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
      const dateStr = d.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });

      card.innerHTML = `
        <div class="card-header">
          <div class="card-header-left">
            <div class="time-stamp"></div>
            <div class="bus-id"></div>
          </div>
          <div class="active-badge">
            <div class="pulse-ring"></div>
            SOS ACTIVE
          </div>
        </div>

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

        <!-- ACTION BUTTONS -->
        <div style="display:flex; gap:10px; margin-bottom:0;">
          <button class="btn-resolve" style="flex:1;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            Mark as Resolved
          </button>
          <button class="btn-chat-toggle" style="flex:1; background: var(--accent-dim); color: var(--accent); border: 1.5px solid #c7d2fe; padding:12px; border-radius:12px; font-weight:600; font-size:13px; font-family:var(--font); cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; transition: all 0.2s;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            Message Driver
          </button>
        </div>

        <!-- EMBEDDED CHAT -->
        <div class="card-chat">
          <div class="chat-label">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;display:inline;vertical-align:middle;margin-right:4px;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            Live Chat with Driver
          </div>
          <div class="chat-messages-wrap">
            <div class="chat-empty-msg">No messages yet. Say something to the driver.</div>
          </div>
          <div class="chat-input-row">
            <input type="text" class="chat-text-input" placeholder="Type a message to the driver…" autocomplete="off">
            <button class="chat-send-btn" title="Send">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
          </div>
        </div>
      `;

      // Safely set text content (prevents XSS)
      card.querySelector('.time-stamp').textContent = `${timeStr} • ${dateStr}`;
      card.querySelector('.bus-id').textContent = alert.bus_id || 'Unknown Bus';
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

      // Resolve button
      card.querySelector('.btn-resolve').addEventListener('click', () => resolveAlert(alert.bus_id));

      // Chat toggle button
      const chatSection = card.querySelector('.card-chat');
      const chatToggleBtn = card.querySelector('.btn-chat-toggle');
      let chatOpen = false;
      let chatLoaded = false;

      chatToggleBtn.addEventListener('click', () => {
        chatOpen = !chatOpen;
        if (chatOpen) {
          chatSection.classList.add('open');
          chatToggleBtn.style.background = '#4f46e5';
          chatToggleBtn.style.color = 'white';
          chatToggleBtn.style.border = '1.5px solid #4f46e5';
          chatToggleBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            Close Chat
          `;
          // Load messages only on first open
          if (!chatLoaded) {
            loadChatMessages(card, alert.bus_id);
            chatLoaded = true;
            // Poll for new messages every 5s while open
            chatPolls[alert.bus_id] = setInterval(() => {
              if (chatOpen) loadChatMessages(card, alert.bus_id);
            }, 5000);
          }
        } else {
          chatSection.classList.remove('open');
          chatToggleBtn.style.background = 'var(--accent-dim)';
          chatToggleBtn.style.color = 'var(--accent)';
          chatToggleBtn.style.border = '1.5px solid #c7d2fe';
          chatToggleBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            Message Driver
          `;
        }
      });

      // Send button
      const input = card.querySelector('.chat-text-input');
      const sendBtn = card.querySelector('.chat-send-btn');

      const doSend = async () => {
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        await sendChatToDriver(card, alert.bus_id, text);
      };

      sendBtn.addEventListener('click', doSend);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') doSend(); });

      container.appendChild(card);
    });

  } catch (err) {
    console.error('[SOS] Load error:', err);
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon-wrap" style="background: var(--red-dim); border-color: var(--red-border); color: var(--red);">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>
        </div>
        <h2>Connection Error</h2>
        <p>Could not load alerts. Check your connection and backend server.</p>
      </div>
    `;
  }
}

async function loadChatMessages(card, busId) {
  const messagesWrap = card.querySelector('.chat-messages-wrap');
  const token = JSON.parse(localStorage.getItem('adminSession'))?.token;

  try {
    const res = await fetch(`${BACKEND_URL}/api/chat/${encodeURIComponent(busId)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    const messages = data.messages || [];

    if (messages.length === 0) {
      messagesWrap.innerHTML = '<div class="chat-empty-msg">No messages yet. Say something to the driver.</div>';
      return;
    }

    const wasAtBottom = messagesWrap.scrollHeight - messagesWrap.scrollTop <= messagesWrap.clientHeight + 40;
    messagesWrap.innerHTML = '';

    messages.forEach(msg => {
      const isAdmin = msg.sender_role === 'admin';
      const bubble = document.createElement('div');
      bubble.className = `chat-bubble ${isAdmin ? 'admin' : 'driver'}`;
      const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
      const safeText = document.createTextNode(msg.message);
      const metaEl = document.createElement('div');
      metaEl.className = 'bubble-meta';
      metaEl.textContent = `${isAdmin ? 'You' : 'Driver'} · ${time}`;
      bubble.appendChild(safeText);
      bubble.appendChild(metaEl);
      messagesWrap.appendChild(bubble);
    });

    if (wasAtBottom) {
      messagesWrap.scrollTop = messagesWrap.scrollHeight;
    }
  } catch (e) {
    console.error('[Chat] Load error:', e);
  }
}

async function sendChatToDriver(card, busId, text) {
  const token = JSON.parse(localStorage.getItem('adminSession'))?.token;
  try {
    const res = await fetch(`${BACKEND_URL}/api/chat/send`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bus_id: busId, message: text })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to send');
    }
    await loadChatMessages(card, busId);
  } catch (e) {
    console.error('[Chat] Send error:', e);
  }
}

async function resolveAlert(busId) {
  if (!confirm(`Resolve the SOS alert for ${String(busId)}?`)) return;

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

    // Clear chat poll for this bus
    if (chatPolls[busId]) {
      clearInterval(chatPolls[busId]);
      delete chatPolls[busId];
    }

    resolvedToday++;
    localStorage.setItem('sos_resolved_count', resolvedToday.toString());
    localStorage.setItem('sos_resolved_date', new Date().toDateString());
    
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
