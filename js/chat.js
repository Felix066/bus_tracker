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
      width: 360px; max-height: 540px;
      background: rgba(13, 18, 30, 0.98);
      backdrop-filter: blur(24px);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 20px;
      box-shadow: 0 24px 64px rgba(0,0,0,0.6);
      z-index: 9999; display: none; flex-direction: column; overflow: hidden;
      font-family: 'Inter', sans-serif;
      animation: chat-pop 0.25s cubic-bezier(0.34,1.56,0.64,1);
    }
    @keyframes chat-pop { from { opacity:0; transform: scale(0.92) translateY(12px); } to { opacity:1; transform: scale(1) translateY(0); } }
    #chat-header {
      padding: 14px 18px;
      background: linear-gradient(135deg, rgba(79,70,229,0.3), rgba(124,58,237,0.2));
      border-bottom: 1px solid rgba(255,255,255,0.08);
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
    }
    .chat-title { font-size: 14px; font-weight: 700; color: #e2e8f0; display: flex; align-items: center; gap: 8px; }
    .chat-online-dot { width:8px; height:8px; border-radius:50%; background:#10b981; box-shadow:0 0 8px #10b981; flex-shrink:0; }
    #chat-header-actions { display: flex; align-items: center; gap: 6px; }
    .chat-icon-btn {
      background: none; border: none; color: #94a3b8; cursor: pointer;
      font-size: 15px; padding: 5px 7px; border-radius: 8px;
      transition: color 0.2s, background 0.2s; line-height: 1;
    }
    .chat-icon-btn:hover { color: #fff; background: rgba(255,255,255,0.1); }
    .chat-clear-btn { color: #f87171; font-size: 12px; padding: 5px 10px; border-radius: 8px; font-weight: 600; }
    .chat-clear-btn:hover { background: rgba(239,68,68,0.15); color: #ef4444; }
    #chat-msg-list {
      flex: 1; overflow-y: auto; padding: 14px 16px;
      display: flex; flex-direction: column; gap: 8px;
      scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.12) transparent;
    }
    #chat-msg-list::-webkit-scrollbar { width: 3px; }
    #chat-msg-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 4px; }
    .chat-empty {
      text-align: center; color: #475569; font-size: 12px; margin: auto;
      padding: 20px 0; line-height: 2;
    }
    .chat-empty-icon { font-size: 28px; display: block; margin-bottom: 6px; opacity: 0.6; }
    #chat-input-bar {
      padding: 10px 14px;
      background: rgba(255,255,255,0.03);
      border-top: 1px solid rgba(255,255,255,0.07);
      display: flex; gap: 8px; align-items: center;
    }
    #chat-text-input {
      flex: 1; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px; padding: 9px 13px; color: #e2e8f0; font-size: 13px;
      outline: none; font-family: 'Inter', sans-serif; transition: border-color 0.2s;
    }
    #chat-text-input:focus { border-color: rgba(99,102,241,0.6); }
    #chat-text-input::placeholder { color: #475569; }
    .chat-action-btn {
      border: none; width: 36px; height: 36px; border-radius: 10px; cursor: pointer;
      font-size: 14px; display: flex; align-items: center; justify-content: center;
      flex-shrink: 0; transition: all 0.2s;
    }
    #chat-send-btn { background: #4f46e5; color: white; }
    #chat-send-btn:hover { background: #4338ca; transform: scale(1.06); }
    #chat-send-btn:active { transform: scale(0.95); }
    #chat-mic-btn { background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.1); color: #94a3b8; }
    #chat-mic-btn:hover { background: rgba(239,68,68,0.15); color: #f87171; border-color: rgba(239,68,68,0.3); }
    #chat-mic-btn.recording {
      background: rgba(239,68,68,0.25); border-color: #ef4444; color: #ef4444;
      animation: pulse-mic 0.9s infinite;
    }
    @keyframes pulse-mic {
      0%,100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.4); }
      50%      { box-shadow: 0 0 0 7px rgba(239,68,68,0); }
    }
    #chat-recording-indicator {
      display: none; align-items: center; gap: 6px;
      font-size: 11px; color: #ef4444; padding: 5px 14px 0;
    }
    .rec-dot { width:6px; height:6px; border-radius:50%; background:#ef4444; animation: blink-dot 0.8s infinite; }
    @keyframes blink-dot { 0%,100%{opacity:1;} 50%{opacity:0.15;} }
    /* Message bubbles */
    .chat-bw { display:flex; flex-direction:column; max-width:82%; user-select:none; }
    .chat-bw.mine { align-self:flex-end; align-items:flex-end; }
    .chat-bw.theirs { align-self:flex-start; align-items:flex-start; }
    .chat-label { font-size:10px; color:#475569; margin-bottom:3px; padding:0 4px; }
    .chat-bubble {
      padding: 9px 13px; border-radius: 16px; font-size: 13px; line-height: 1.5;
      word-break: break-word; box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      transition: transform 0.15s; cursor: default;
    }
    .chat-bubble.mine { background: linear-gradient(135deg,#4f46e5,#7c3aed); color:#fff; border-bottom-right-radius:4px; }
    .chat-bubble.theirs { background: rgba(255,255,255,0.08); color:#e2e8f0; border-bottom-left-radius:4px; }
    .chat-bubble:active { transform: scale(0.97); }
    .chat-bubble audio { width:200px; height:34px; border-radius:8px; display:block; margin-top:4px; }
    .chat-voice-label { font-size:10px; opacity:0.65; margin-bottom:3px; }
    /* Delete popup */
    .chat-delete-popup {
      position: absolute; background: rgba(20,20,35,0.97); border: 1px solid rgba(239,68,68,0.3);
      border-radius: 10px; padding: 4px; z-index: 10001; box-shadow: 0 8px 24px rgba(0,0,0,0.5);
    }
    .chat-delete-popup button {
      display: flex; align-items: center; gap: 6px; padding: 7px 12px;
      background: none; border: none; color: #f87171; font-size: 12px; font-weight: 600;
      cursor: pointer; border-radius: 8px; font-family: 'Inter',sans-serif; white-space: nowrap;
    }
    .chat-delete-popup button:hover { background: rgba(239,68,68,0.15); }
    /* Read-only banner */
    #chat-readonly-banner {
      padding: 8px 16px;
      background: rgba(99,102,241,0.08);
      border-top: 1px solid rgba(99,102,241,0.15);
      text-align: center; font-size: 11px; color: #6366f1; font-weight: 600;
      letter-spacing: 0.3px;
    }
    /* SOS lock */
    #sos-chat-warning {
      padding: 10px 14px;
      background: rgba(239,68,68,0.08);
      border-top: 1px solid rgba(239,68,68,0.15);
      text-align: center; font-size: 11px; color: #f87171;
    }
    .admin-view .chat-bubble.mine { background: rgba(255,255,255,0.08) !important; }
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

  // Close popup on outside click
  document.addEventListener('click', e => {
    const popup = document.getElementById('chat-delete-popup');
    if (popup && !popup.contains(e.target)) popup.remove();
  });
}

// ============================================================================
// HELPER
// ============================================================================
function _getToken() {
  const s = JSON.parse(localStorage.getItem('driverSession') || localStorage.getItem('userSession') || '{}');
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

  // Delete trigger (driver only, own messages)
  if (isMine && window.chatUserRole === 'driver' && msg.id) {
    // 1. Long press (Mobile & PC hold)
    const onLongPress = () => {
      longPressTimer = setTimeout(() => showDeletePopup(msg.id, wrap), 600);
    };
    const cancelPress = () => clearTimeout(longPressTimer);
    
    bubble.addEventListener('mousedown',  onLongPress);
    bubble.addEventListener('touchstart', onLongPress, { passive: true });
    bubble.addEventListener('mouseup',    cancelPress);
    bubble.addEventListener('mouseleave', cancelPress);
    bubble.addEventListener('touchend',   cancelPress);
    
    // 2. Right click (PC)
    bubble.addEventListener('contextmenu', e => { e.preventDefault(); showDeletePopup(msg.id, wrap); });
    
    // 3. Double click (PC - very intuitive)
    bubble.addEventListener('dblclick', e => { e.preventDefault(); showDeletePopup(msg.id, wrap); });
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
