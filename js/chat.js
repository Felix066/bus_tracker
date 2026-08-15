// js/chat.js — Fixed Chat System
// Fixes: immediate display on send, correct Realtime filter, admin read-only,
//        long-press delete, voice (cross-browser), auto-clear on trip end.

let chatSubscription = null;
let currentChatBusId = null;
let isChatOpen = false;
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let longPressTimer = null;

// ============================================================================
// TOGGLE / OPEN / CLOSE
// ============================================================================
function toggleChat() {
  const panel = document.getElementById('chat-panel');
  const badge = document.getElementById('chat-badge');
  isChatOpen = !isChatOpen;
  if (isChatOpen) {
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';
    if (badge) badge.style.display = 'none';
    setTimeout(() => {
      const c = document.getElementById('chat-msg-list');
      if (c) c.scrollTop = c.scrollHeight;
    }, 50);
  } else {
    panel.style.display = 'none';
  }
}

// ============================================================================
// INIT
// ============================================================================
async function initChat(busId, userRole) {
  currentChatBusId = busId;
  window.currentChatBusId = busId;
  window.chatUserRole = userRole;

  _injectStyles();
  _injectPanel(userRole);

  // Load history
  const token = _getToken();
  if (!token) return;

  try {
    const res = await fetch(`${BACKEND_URL}/api/chat/${encodeURIComponent(busId)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success) {
      const container = document.getElementById('chat-msg-list');
      if (container) container.innerHTML = '';
      if (!data.messages || data.messages.length === 0) {
        _showEmpty();
      } else {
        data.messages.forEach(msg => appendMessage(msg));
      }
      if (userRole === 'driver') handleSosChatLock(data.isSosActive);
    }
  } catch (err) {
    console.error('[Chat] Failed to load history:', err);
  }

  // Realtime subscription
  if (chatSubscription) supabase.removeChannel(chatSubscription);
  chatSubscription = supabase
    .channel(`chat_${busId.replace(/\s+/g, '_')}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'driver_messages',
      filter: `bus_id=eq.${busId}`
    }, payload => {
      if (payload.new) {
        // Only append from Realtime if NOT already shown (avoid duplicates from optimistic UI)
        const existing = document.querySelector(`[data-msg-id="${payload.new.id}"]`);
        if (!existing) appendMessage(payload.new);
      }
      const badge = document.getElementById('chat-badge');
      if (!isChatOpen && payload.new?.sender_role !== window.chatUserRole && badge) {
        badge.style.display = 'flex';
      }
    })
    .on('postgres_changes', {
      event: 'DELETE',
      schema: 'public',
      table: 'driver_messages',
      filter: `bus_id=eq.${busId}`
    }, payload => {
      if (payload.old?.id) {
        const el = document.querySelector(`[data-msg-id="${payload.old.id}"]`);
        if (el) el.remove();
        const container = document.getElementById('chat-msg-list');
        if (container && container.children.length === 0) _showEmpty();
      }
    })
    .subscribe();

  if (userRole === 'driver') {
    supabase.channel(`sos_${busId.replace(/\s+/g, '_')}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'sos_alerts',
        filter: `bus_id=eq.${busId}`
      }, payload => {
        handleSosChatLock(payload.new?.status === 'active');
      }).subscribe();
  }
}

// ============================================================================
// PANEL INJECTION
// ============================================================================
function _injectStyles() {
  if (document.getElementById('chat-styles')) return;
  const style = document.createElement('style');
  style.id = 'chat-styles';
  style.textContent = `
    #chat-panel {
      position: fixed; bottom: 80px; right: 24px;
      width: 380px; max-height: 540px; height: 80vh;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 20px;
      box-shadow: 0 20px 40px -15px rgba(15, 23, 42, 0.15);
      z-index: 9999; display: none; flex-direction: column; overflow: hidden;
      font-family: 'Inter', sans-serif;
      animation: chat-pop 0.25s cubic-bezier(0.34,1.56,0.64,1);
    }
    @keyframes chat-pop { from { opacity:0; transform: scale(0.92) translateY(12px); } to { opacity:1; transform: scale(1) translateY(0); } }
    #chat-header {
      padding: 16px 20px;
      background: #ffffff;
      border-bottom: 1px solid #e2e8f0;
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
    }
    .chat-title { font-size: 15px; font-weight: 700; color: #0f172a; display: flex; align-items: center; gap: 8px; }
    .chat-online-dot { width:8px; height:8px; border-radius:50%; background:#10b981; box-shadow:0 0 8px rgba(16,185,129,0.5); flex-shrink:0; }
    #chat-header-actions { display: flex; align-items: center; gap: 8px; }
    .chat-icon-btn {
      background: #f1f5f9; border: none; color: #64748b; cursor: pointer;
      font-size: 14px; width:32px; height:32px; border-radius: 8px; display:flex; align-items:center; justify-content:center;
      transition: all 0.2s;
    }
    .chat-icon-btn:hover { color: #0f172a; background: #e2e8f0; }
    .chat-clear-btn { width: auto; padding: 0 12px; font-weight: 600; font-size:12px; color: #ef4444; background: rgba(239,68,68,0.1); }
    .chat-clear-btn:hover { background: rgba(239,68,68,0.15); color: #dc2626; }
    
    #chat-msg-list {
      flex: 1; overflow-y: auto; padding: 16px 20px;
      display: flex; flex-direction: column; gap: 12px; background: #f8fafc;
      scrollbar-width: thin; scrollbar-color: #cbd5e1 transparent;
    }
    #chat-msg-list::-webkit-scrollbar { width: 4px; }
    #chat-msg-list::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
    
    .chat-empty {
      text-align: center; color: #64748b; font-size: 13px; font-weight:500; margin: auto;
      padding: 20px 0; line-height: 1.6;
    }
    .chat-empty-icon { font-size: 28px; display: block; margin-bottom: 6px; opacity: 0.8; }
    
    #chat-input-bar {
      padding: 14px 20px;
      background: #ffffff;
      border-top: 1px solid #e2e8f0;
      display: flex; gap: 10px; align-items: center;
    }
    #chat-text-input {
      flex: 1; background: #f8fafc; border: 1.5px solid #e2e8f0;
      border-radius: 12px; padding: 12px 16px; color: #0f172a; font-size: 14px;
      outline: none; font-family: 'Inter', sans-serif; transition: border-color 0.2s;
    }
    #chat-text-input:focus { border-color: #4f46e5; }
    #chat-text-input::placeholder { color: #94a3b8; }
    
    .chat-action-btn {
      border: none; width: 42px; height: 42px; border-radius: 12px; cursor: pointer;
      font-size: 15px; display: flex; align-items: center; justify-content: center;
      flex-shrink: 0; transition: all 0.2s;
    }
    #chat-send-btn { background: #4f46e5; color: white; }
    #chat-send-btn:hover { background: #4338ca; transform: translateY(-1px); box-shadow: 0 4px 10px rgba(79,70,229,0.25); }
    #chat-send-btn:active { transform: scale(0.96); }
    
    #chat-mic-btn { background: #f1f5f9; border: 1.5px solid transparent; color: #64748b; }
    #chat-mic-btn:hover { background: rgba(239,68,68,0.1); color: #ef4444; }
    #chat-mic-btn.recording {
      background: rgba(239,68,68,0.15); border-color: rgba(239,68,68,0.3); color: #ef4444;
      animation: pulse-mic 1s infinite;
    }
    @keyframes pulse-mic {
      0%,100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.3); }
      50%      { box-shadow: 0 0 0 6px rgba(239,68,68,0); }
    }
    
    #chat-recording-indicator {
      display: none; align-items: center; gap: 8px;
      font-size: 12px; font-weight:600; color: #ef4444; padding: 10px 20px 0; background: #ffffff;
    }
    .rec-dot { width:8px; height:8px; border-radius:50%; background:#ef4444; animation: blink-dot 0.8s infinite; }
    @keyframes blink-dot { 0%,100%{opacity:1;} 50%{opacity:0.2;} }
    
    /* Message bubbles */
    .chat-bw { display:flex; flex-direction:column; max-width:85%; user-select:none; }
    .chat-bw.mine { align-self:flex-end; align-items:flex-end; }
    .chat-bw.theirs { align-self:flex-start; align-items:flex-start; }
    .chat-label { font-size:11px; font-weight:500; color:#64748b; margin-bottom:4px; padding:0 4px; }
    .chat-bubble {
      padding: 10px 14px; border-radius: 14px; font-size: 13.5px; line-height: 1.5;
      word-break: break-word; box-shadow: 0 2px 4px rgba(15,23,42,0.03);
      transition: transform 0.15s; cursor: default; border: 1px solid transparent;
    }
    .chat-bubble.mine { background: #4f46e5; color:#ffffff; border-bottom-right-radius:4px; }
    .chat-bubble.theirs { background: #ffffff; color:#0f172a; border-color:#e2e8f0; border-bottom-left-radius:4px; }
    .chat-bubble:active { transform: scale(0.98); }
    .chat-bubble audio { width:210px; height:36px; border-radius:8px; display:block; margin-top:4px; }
    .chat-voice-label { font-size:11px; font-weight:600; opacity:0.8; margin-bottom:4px; }
    
    /* Delete popup */
    .chat-delete-popup {
      position: absolute; background: #ffffff; border: 1px solid #e2e8f0;
      border-radius: 12px; padding: 4px; z-index: 10001; box-shadow: 0 10px 25px -5px rgba(15,23,42,0.15);
    }
    .chat-delete-popup button {
      display: flex; align-items: center; gap: 8px; padding: 10px 14px;
      background: none; border: none; color: #ef4444; font-size: 13px; font-weight: 600;
      cursor: pointer; border-radius: 8px; font-family: 'Inter',sans-serif; white-space: nowrap; width:100%;
    }
    .chat-delete-popup button:hover { background: rgba(239,68,68,0.1); }
    
    /* Read-only banner & SOS lock */
    #chat-readonly-banner {
      padding: 10px 20px; background: #eef2ff; border-top: 1px solid #e0e7ff;
      text-align: center; font-size: 12px; color: #4f46e5; font-weight: 600;
    }
    #sos-chat-warning {
      padding: 12px 20px; background: #fef2f2; border-top: 1px solid #fee2e2;
      text-align: center; font-size: 12px; font-weight: 600; color: #ef4444;
    }
    .admin-view .chat-bubble.mine { background: #f1f5f9 !important; color:#0f172a; border-color:#e2e8f0; }
  `;
  document.head.appendChild(style);
}

function _injectPanel(userRole) {
  if (document.getElementById('chat-panel')) return;

  const isAdmin = userRole === 'admin';
  const inputBar = isAdmin ? '' : `
    <div id="chat-recording-indicator">
      <span class="rec-dot"></span> Recording voice…
    </div>
    <div id="chat-input-bar">
      <input type="text" id="chat-text-input" placeholder="Type a message…" autocomplete="off">
      <button class="chat-action-btn" id="chat-mic-btn" title="Hold to record voice">
        <i class="fas fa-microphone"></i>
      </button>
      <button class="chat-action-btn" id="chat-send-btn">
        <i class="fas fa-paper-plane"></i>
      </button>
    </div>`;

  const readonlyBanner = isAdmin
    ? `<div id="chat-readonly-banner"><i class="fas fa-eye" style="margin-right:5px;"></i>Read-only — driver messages appear here</div>`
    : '';

  const clearBtn = isAdmin
    ? `<button class="chat-icon-btn chat-clear-btn" id="chat-clear-btn" title="Clear all messages" onclick="clearAllChat()">
        <i class="fas fa-trash-alt"></i> Clear
       </button>`
    : '';

  const html = `
    <div id="chat-panel" class="${isAdmin ? 'admin-view' : ''}">
      <div id="chat-header">
        <span class="chat-title">
          <span class="chat-online-dot"></span>
          ${isAdmin ? 'Driver Messages' : 'Dispatcher Chat'}
        </span>
        <div id="chat-header-actions">
          ${clearBtn}
          <button class="chat-icon-btn" onclick="toggleChat()" title="Close"><i class="fas fa-times"></i></button>
        </div>
      </div>
      <div id="chat-msg-list"></div>
      ${readonlyBanner}
      ${inputBar}
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);

  if (!isAdmin) {
    document.getElementById('chat-text-input').addEventListener('keypress', e => {
      if (e.key === 'Enter') sendChatMessage();
    });
    document.getElementById('chat-send-btn').addEventListener('click', sendChatMessage);

    const mic = document.getElementById('chat-mic-btn');
    mic.addEventListener('mousedown',  startVoiceRecording);
    mic.addEventListener('touchstart', startVoiceRecording, { passive: true });
    mic.addEventListener('mouseup',    stopVoiceRecording);
    mic.addEventListener('touchend',   stopVoiceRecording);
    mic.addEventListener('mouseleave', stopVoiceRecording);
  }

  // Close popup or panel on outside click
  document.addEventListener('click', e => {
    // 1. Delete popup
    const popup = document.getElementById('chat-delete-popup');
    if (popup && !popup.contains(e.target)) popup.remove();
    
    // 2. Chat panel (if click is outside panel AND not on a button that opens it)
    const panel = document.getElementById('chat-panel');
    if (isChatOpen && panel && !panel.contains(e.target)) {
      // Find if clicked element is one of the toggle buttons
      const isToggleButton = e.target.closest('.btn-chat-toggle, .chat-icon-btn, .btn-edit-row[title="View Chat"], [onclick^="toggleChat"]');
      if (!isToggleButton) {
        toggleChat();
      }
    }
  });
}

// ============================================================================
// HELPER
// ============================================================================
function _getToken() {
  const s = JSON.parse(localStorage.getItem('driverSession') || localStorage.getItem('adminSession') || localStorage.getItem('userSession') || '{}');
  return s.token || null;
}

function _showEmpty() {
  const c = document.getElementById('chat-msg-list');
  if (!c) return;
  c.innerHTML = `<div class="chat-empty">
    <span class="chat-empty-icon">💬</span>
    No messages yet.<br>
    <span style="font-size:11px;">Driver messages will appear here.</span>
  </div>`;
}

// ============================================================================
// APPEND MESSAGE
// ============================================================================
function appendMessage(msg) {
  const container = document.getElementById('chat-msg-list');
  if (!container) return;

  // Clear empty state
  const emptyEl = container.querySelector('.chat-empty');
  if (emptyEl) emptyEl.remove();

  const isMine = msg.sender_role === window.chatUserRole;
  const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const roleLabel = isMine ? 'You' : (msg.sender_role === 'admin' ? '📡 Dispatcher' : '🚌 Driver');

  const wrap = document.createElement('div');
  wrap.className = `chat-bw ${isMine ? 'mine' : 'theirs'}`;
  wrap.setAttribute('data-msg-id', msg.id || '');

  const label = document.createElement('div');
  label.className = 'chat-label';
  label.textContent = `${roleLabel} · ${time}`;

  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${isMine ? 'mine' : 'theirs'}`;

  if (msg.message && msg.message.startsWith('[VOICE]:')) {
    const url = msg.message.replace('[VOICE]:', '').trim();
    bubble.innerHTML = `<div class="chat-voice-label">🎤 Voice Message</div><audio controls src="${url}" preload="none"></audio>`;
  } else {
    const safe = document.createElement('span');
    safe.innerText = msg.message || '';
    bubble.appendChild(safe);
  }

  // Delete trigger (admin can delete any, driver can delete own messages)
  if (window.chatUserRole === 'admin' || (isMine && window.chatUserRole === 'driver')) {
    // 1. Long press (Mobile & PC hold)
    const onLongPress = () => {
      const currentId = wrap.getAttribute('data-msg-id');
      if (!currentId) return; // Wait for server to confirm ID
      longPressTimer = setTimeout(() => showDeletePopup(currentId, wrap), 600);
    };
    const cancelPress = () => clearTimeout(longPressTimer);
    
    bubble.addEventListener('mousedown',  onLongPress);
    bubble.addEventListener('touchstart', onLongPress, { passive: true });
    bubble.addEventListener('mouseup',    cancelPress);
    bubble.addEventListener('mouseleave', cancelPress);
    bubble.addEventListener('touchend',   cancelPress);
    
    // 2. Right click (PC)
    bubble.addEventListener('contextmenu', e => { 
      e.preventDefault(); 
      const currentId = wrap.getAttribute('data-msg-id');
      if (currentId) showDeletePopup(currentId, wrap); 
    });
    
    // 3. Double click (PC - very intuitive)
    bubble.addEventListener('dblclick', e => { 
      e.preventDefault(); 
      const currentId = wrap.getAttribute('data-msg-id');
      if (currentId) showDeletePopup(currentId, wrap); 
    });
  }

  wrap.appendChild(label);
  wrap.appendChild(bubble);
  container.appendChild(wrap);
  container.scrollTop = container.scrollHeight;
}

// ============================================================================
// DELETE INDIVIDUAL MESSAGE (long-press popup)
// ============================================================================
function showDeletePopup(msgId, wrapEl) {
  // Remove any existing popup
  const old = document.getElementById('chat-delete-popup');
  if (old) old.remove();

  const popup = document.createElement('div');
  popup.id = 'chat-delete-popup';
  popup.className = 'chat-delete-popup';
  popup.innerHTML = `<button onclick="deleteSingleMessage('${msgId}')"><i class="fas fa-trash-alt"></i> Delete message</button>`;

  // Position near the bubble
  const rect = wrapEl.getBoundingClientRect();
  popup.style.position = 'fixed';
  popup.style.top = `${rect.top - 50}px`;
  popup.style.left = `${Math.min(rect.left, window.innerWidth - 180)}px`;
  document.body.appendChild(popup);
}

async function deleteSingleMessage(msgId) {
  const popup = document.getElementById('chat-delete-popup');
  if (popup) popup.remove();

  const token = _getToken();
  if (!token || !msgId) return;

  try {
    const res = await fetch(`${BACKEND_URL}/api/chat/message/${msgId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      // Remove optimistically (Realtime DELETE event will confirm)
      const el = document.querySelector(`[data-msg-id="${msgId}"]`);
      if (el) el.remove();
      const c = document.getElementById('chat-msg-list');
      if (c && c.children.length === 0) _showEmpty();
    } else {
      console.error('[Chat] Delete failed:', await res.json());
    }
  } catch (e) {
    console.error('[Chat] Delete error:', e);
  }
}

// ============================================================================
// ADMIN CLEAR ALL
// ============================================================================
async function clearAllChat() {
  if (!currentChatBusId) return;
  if (!confirm(`Clear all chat messages for ${currentChatBusId}?`)) return;

  const token = _getToken();
  if (!token) return;

  try {
    const res = await fetch(`${BACKEND_URL}/api/chat/${encodeURIComponent(currentChatBusId)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const c = document.getElementById('chat-msg-list');
      if (c) c.innerHTML = '';
      _showEmpty();
    }
  } catch (e) {
    console.error('[Chat] Clear all error:', e);
  }
}

// ============================================================================
// AUTO-CLEAR ON TRIP END (called by trip.js)
// ============================================================================
async function clearChatOnTripEnd(busId) {
  const token = _getToken();
  if (!token || !busId) return;
  try {
    await fetch(`${BACKEND_URL}/api/chat/${encodeURIComponent(busId)}/trip-end`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log('[Chat] Trip ended — chat cleared');
  } catch (e) {
    console.warn('[Chat] Could not auto-clear chat on trip end:', e.message);
  }
}

// ============================================================================
// SEND TEXT MESSAGE
// ============================================================================
async function sendChatMessage() {
  const input = document.getElementById('chat-text-input');
  const message = input?.value.trim();
  if (!message || !currentChatBusId) return;

  const token = _getToken();
  if (!token) return;

  input.value = '';
  input.focus();

  // Optimistic UI — show immediately without waiting for Realtime
  const optimisticMsg = {
    id: null,
    bus_id: currentChatBusId,
    message,
    sender_role: window.chatUserRole,
    created_at: new Date().toISOString()
  };
  appendMessage(optimisticMsg);

  try {
    const res = await fetch(`${BACKEND_URL}/api/chat/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ bus_id: currentChatBusId, message })
    });
    if (res.ok) {
      const data = await res.json();
      // Patch the optimistic message's data-msg-id so long-press delete works
      if (data.data?.id) {
        const bubbles = document.querySelectorAll('[data-msg-id=""]');
        if (bubbles.length > 0) {
          bubbles[bubbles.length - 1].setAttribute('data-msg-id', data.data.id);
        }
      }
    } else {
      const err = await res.json();
      console.error('[Chat] Send error:', err);
      // Revert optimistic message
      const c = document.getElementById('chat-msg-list');
      const last = c?.querySelector('[data-msg-id=""]');
      if (last) last.remove();
      if (c && c.children.length === 0) _showEmpty();
    }
  } catch (e) {
    console.error('[Chat] Network error:', e);
  }
}

// ============================================================================
// SOS CHAT LOCK — driver can only chat during active SOS
// ============================================================================
function handleSosChatLock(isSosActive) {
  const inputBar = document.getElementById('chat-input-bar');
  let sosWarn = document.getElementById('sos-chat-warning');

  if (isSosActive) {
    if (inputBar) inputBar.style.display = 'flex';
    if (sosWarn) sosWarn.remove();
  } else {
    if (inputBar) inputBar.style.display = 'none';
    if (!sosWarn) {
      sosWarn = document.createElement('div');
      sosWarn.id = 'sos-chat-warning';
      sosWarn.innerHTML = `<i class="fas fa-lock" style="margin-right:6px;"></i>Chat is available only during active SOS.`;
      const panel = document.getElementById('chat-panel');
      if (panel) panel.appendChild(sosWarn);
    }
  }
}

// ============================================================================
// VOICE RECORDING
// ============================================================================
function _getSupportedMimeType() {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4'
  ];
  return types.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

async function startVoiceRecording(e) {
  e.preventDefault();
  if (isRecording) return;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    const mimeType = _getSupportedMimeType();
    mediaRecorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);

    mediaRecorder.ondataavailable = ev => {
      if (ev.data.size > 0) audioChunks.push(ev.data);
    };
    mediaRecorder.onstop = async () => {
      const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      stream.getTracks().forEach(t => t.stop());
      await _uploadAndSendVoice(blob, mediaRecorder.mimeType);
    };

    mediaRecorder.start(200); // collect chunks every 200ms
    isRecording = true;
    const mic = document.getElementById('chat-mic-btn');
    const rec = document.getElementById('chat-recording-indicator');
    if (mic) mic.classList.add('recording');
    if (rec) rec.style.display = 'flex';
  } catch (err) {
    console.error('[Chat] Mic error:', err);
    alert('Microphone access denied. Please allow microphone permission.');
  }
}

function stopVoiceRecording() {
  if (!isRecording || !mediaRecorder) return;
  isRecording = false;
  try { mediaRecorder.stop(); } catch (_) {}
  const mic = document.getElementById('chat-mic-btn');
  const rec = document.getElementById('chat-recording-indicator');
  if (mic) mic.classList.remove('recording');
  if (rec) rec.style.display = 'none';
}

async function _uploadAndSendVoice(blob, mimeType) {
  if (!currentChatBusId) return;
  const token = _getToken();
  if (!token) return;

  const ext = (mimeType || '').includes('ogg') ? 'ogg' : (mimeType || '').includes('mp4') ? 'mp4' : 'webm';
  const fileName = `voice_${currentChatBusId.replace(/\s+/g, '_')}_${Date.now()}.${ext}`;

  try {
    // Upload to Supabase Storage
    const { error: uploadErr } = await supabase.storage
      .from('chat-audio')
      .upload(fileName, blob, { contentType: blob.type || 'audio/webm', upsert: false });

    if (uploadErr) throw uploadErr;

    const { data: { publicUrl } } = supabase.storage.from('chat-audio').getPublicUrl(fileName);

    // Send as a message
    const res = await fetch(`${BACKEND_URL}/api/chat/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ bus_id: currentChatBusId, message: `[VOICE]:${publicUrl}` })
    });

    if (res.ok) {
      const data = await res.json();
      if (data.data) appendMessage(data.data);
    }
  } catch (err) {
    console.error('[Chat] Voice upload error:', err);
    alert('Failed to send voice message. Make sure the chat-audio storage bucket exists in Supabase.');
  }
}

// ============================================================================
// EXPORTS
// ============================================================================
window.toggleChat       = toggleChat;
window.initChat         = initChat;
window.sendChatMessage  = sendChatMessage;
window.clearAllChat     = clearAllChat;
window.deleteSingleMessage = deleteSingleMessage;
window.clearChatOnTripEnd  = clearChatOnTripEnd;
