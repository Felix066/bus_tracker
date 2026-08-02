// js/chat.js — Modern Chat UI with Voice Messaging
let chatSubscription = null;
let currentChatBusId = null;
let isChatOpen = false;
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

function toggleChat() {
  const panel = document.getElementById('chat-panel');
  const badge = document.getElementById('chat-badge');
  isChatOpen = !isChatOpen;
  
  if (isChatOpen) {
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';
    if(badge) badge.style.display = 'none';
    setTimeout(() => {
      const msgContainer = document.getElementById('chat-messages');
      if (msgContainer) msgContainer.scrollTop = msgContainer.scrollHeight;
    }, 50);
  } else {
    panel.style.display = 'none';
  }
}

async function initChat(busId, userRole) {
  currentChatBusId = busId;
  window.chatUserRole = userRole;
  
  // Inject modern chat styles if not already present
  if (!document.getElementById('chat-styles')) {
    const style = document.createElement('style');
    style.id = 'chat-styles';
    style.textContent = `
      #chat-panel {
        position: fixed;
        bottom: 80px;
        right: 24px;
        width: 360px;
        height: 520px;
        background: rgba(15, 23, 42, 0.97);
        backdrop-filter: blur(20px);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 20px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.5);
        z-index: 9999;
        display: none;
        flex-direction: column;
        overflow: hidden;
        font-family: 'Inter', sans-serif;
      }
      #chat-header {
        padding: 16px 20px;
        background: rgba(79, 70, 229, 0.2);
        border-bottom: 1px solid rgba(255,255,255,0.08);
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      #chat-header .chat-title {
        font-size: 15px;
        font-weight: 700;
        color: #e2e8f0;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      #chat-header .chat-title::before {
        content: '';
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #10b981;
        box-shadow: 0 0 8px #10b981;
        display: inline-block;
      }
      #chat-close-btn {
        background: none;
        border: none;
        color: #94a3b8;
        cursor: pointer;
        font-size: 18px;
        padding: 4px;
        border-radius: 6px;
        transition: color 0.2s, background 0.2s;
      }
      #chat-close-btn:hover { color: #fff; background: rgba(255,255,255,0.1); }
      #chat-messages {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        scrollbar-width: thin;
        scrollbar-color: rgba(255,255,255,0.15) transparent;
      }
      #chat-messages::-webkit-scrollbar { width: 4px; }
      #chat-messages::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 4px; }
      #chat-input-bar {
        padding: 12px 16px;
        background: rgba(255,255,255,0.04);
        border-top: 1px solid rgba(255,255,255,0.08);
        display: flex;
        gap: 8px;
        align-items: center;
      }
      #chat-input {
        flex: 1;
        background: rgba(255,255,255,0.08);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 12px;
        padding: 10px 14px;
        color: #e2e8f0;
        font-size: 13px;
        outline: none;
        transition: border-color 0.2s;
      }
      #chat-input:focus { border-color: rgba(79, 70, 229, 0.7); }
      #chat-input::placeholder { color: #64748b; }
      #chat-send-btn {
        background: #4f46e5;
        border: none;
        color: white;
        width: 38px;
        height: 38px;
        border-radius: 12px;
        cursor: pointer;
        font-size: 15px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s, transform 0.1s;
        flex-shrink: 0;
      }
      #chat-send-btn:hover { background: #4338ca; transform: scale(1.05); }
      #chat-mic-btn {
        background: rgba(255,255,255,0.08);
        border: 1px solid rgba(255,255,255,0.12);
        color: #94a3b8;
        width: 38px;
        height: 38px;
        border-radius: 12px;
        cursor: pointer;
        font-size: 15px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
        flex-shrink: 0;
      }
      #chat-mic-btn:hover { background: rgba(239,68,68,0.2); color: #ef4444; }
      #chat-mic-btn.recording {
        background: rgba(239,68,68,0.3);
        border-color: #ef4444;
        color: #ef4444;
        animation: pulse-red 1s infinite;
      }
      @keyframes pulse-red {
        0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.4); }
        50% { box-shadow: 0 0 0 8px rgba(239,68,68,0); }
      }
      .chat-bubble-wrap {
        display: flex;
        flex-direction: column;
        max-width: 82%;
      }
      .chat-bubble-wrap.mine { align-self: flex-end; align-items: flex-end; }
      .chat-bubble-wrap.theirs { align-self: flex-start; align-items: flex-start; }
      .chat-label {
        font-size: 10px;
        color: #64748b;
        margin-bottom: 3px;
        padding: 0 4px;
      }
      .chat-bubble {
        padding: 10px 14px;
        border-radius: 18px;
        font-size: 13px;
        line-height: 1.5;
        word-break: break-word;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      }
      .chat-bubble.mine {
        background: linear-gradient(135deg, #4f46e5, #7c3aed);
        color: white;
        border-bottom-right-radius: 4px;
      }
      .chat-bubble.theirs {
        background: rgba(255,255,255,0.08);
        color: #e2e8f0;
        border-bottom-left-radius: 4px;
      }
      .chat-bubble audio {
        width: 200px;
        height: 36px;
        border-radius: 8px;
        display: block;
      }
      .chat-recording-indicator {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: #ef4444;
        padding: 6px 12px;
        background: rgba(239,68,68,0.1);
        border-radius: 8px;
        margin: 0 16px 4px;
      }
      .chat-recording-indicator .dot {
        width: 6px; height: 6px;
        border-radius: 50%;
        background: #ef4444;
        animation: blink 0.8s infinite;
      }
      @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.2; } }
    `;
    document.head.appendChild(style);
  }

  // Inject chat panel HTML if not yet present
  if (!document.getElementById('chat-panel')) {
    const panelHtml = `
      <div id="chat-panel">
        <div id="chat-header">
          <span class="chat-title">Dispatcher Chat</span>
          <button id="chat-close-btn" onclick="toggleChat()"><i class="fas fa-times"></i></button>
        </div>
        <div id="chat-messages"></div>
        <div id="chat-recording-bar" style="display:none;" class="chat-recording-indicator">
          <span class="dot"></span> Recording voice message...
        </div>
        <div id="chat-input-bar">
          <input type="text" id="chat-input" placeholder="Type a message...">
          <button id="chat-mic-btn" title="Hold to record voice message"><i class="fas fa-microphone"></i></button>
          <button id="chat-send-btn" onclick="sendChatMessage()"><i class="fas fa-paper-plane"></i></button>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', panelHtml);
    
    // Re-attach Enter key listener
    document.getElementById('chat-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendChatMessage();
    });

    // Mic button hold to record
    const micBtn = document.getElementById('chat-mic-btn');
    micBtn.addEventListener('mousedown', startVoiceRecording);
    micBtn.addEventListener('touchstart', startVoiceRecording, { passive: true });
    micBtn.addEventListener('mouseup', stopVoiceRecording);
    micBtn.addEventListener('touchend', stopVoiceRecording);
    micBtn.addEventListener('mouseleave', stopVoiceRecording);
  }

  // Fetch existing messages
  const session = JSON.parse(localStorage.getItem('userSession'));
  const token = session?.token;
  
  try {
    const res = await fetch(`${BACKEND_URL}/api/chat/${busId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success) {
      const container = document.getElementById('chat-messages');
      container.innerHTML = '';
      if (data.messages.length === 0) {
        container.innerHTML = `<div style="text-align:center; color:#64748b; font-size:12px; margin-top:40px; line-height:1.8;">
          <div style="font-size:28px; margin-bottom:8px;">💬</div>
          No messages yet.<br><span style="font-size:11px;">Start a conversation with your driver!</span>
        </div>`;
      } else {
        data.messages.forEach(msg => appendMessage(msg));
      }

      if (window.chatUserRole === 'driver') {
        handleSosChatLock(data.isSosActive);
      }
    }
  } catch (err) {
    console.error('Error fetching chat history', err);
  }

  // Subscribe to new messages via Supabase Realtime
  if (chatSubscription) {
    supabase.removeChannel(chatSubscription);
  }
  
  chatSubscription = supabase
    .channel(`chat_${busId}`)
    .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'driver_messages', 
        filter: `bus_id=eq.${busId}` 
      }, payload => {
      appendMessage(payload.new);
      const badge = document.getElementById('chat-badge');
      if (!isChatOpen && payload.new.sender_role !== window.chatUserRole && badge) {
        badge.style.display = 'flex';
      }
    })
    .subscribe();

  if (window.chatUserRole === 'driver') {
    // Listen for SOS alerts
    supabase.channel(`sos_alerts_${busId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sos_alerts', filter: `bus_id=eq.${busId}` }, payload => {
        const isSosActive = payload.new && payload.new.status === 'active';
        handleSosChatLock(isSosActive);
      }).subscribe();
  }
}

function handleSosChatLock(isSosActive) {
  const inputBar = document.getElementById('chat-input-bar');
  const container = document.getElementById('chat-messages');
  let sosWarning = document.getElementById('sos-chat-warning');
  
  if (isSosActive) {
    if (inputBar) inputBar.style.display = 'flex';
    if (sosWarning) sosWarning.remove();
  } else {
    if (inputBar) inputBar.style.display = 'none';
    if (!sosWarning && container) {
      sosWarning = document.createElement('div');
      sosWarning.id = 'sos-chat-warning';
      sosWarning.innerHTML = `
        <div style="background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.2); color:#ef4444; border-radius:12px; padding:12px; margin-top:auto; font-size:12px; text-align:center;">
          <i class="fas fa-lock" style="margin-bottom:6px; font-size:16px;"></i><br>
          Chat is disabled. You can only message Dispatcher during an active SOS.
        </div>
      `;
      container.appendChild(sosWarning);
      container.scrollTop = container.scrollHeight;
    }
  }
}

function appendMessage(msg) {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  
  // Remove "No messages" placeholder if present
  if (container.querySelector('[style*="No messages"]') || container.innerHTML.includes('No messages')) {
    container.innerHTML = '';
  }

  const isMine = msg.sender_role === window.chatUserRole;
  const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const roleLabel = isMine ? 'You' : (msg.sender_role === 'admin' ? '📡 Dispatcher' : '🚌 Driver');

  const wrap = document.createElement('div');
  wrap.className = `chat-bubble-wrap ${isMine ? 'mine' : 'theirs'}`;

  const label = document.createElement('div');
  label.className = 'chat-label';
  label.textContent = `${roleLabel} · ${time}`;

  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${isMine ? 'mine' : 'theirs'}`;

  // Check if message is a voice note
  if (msg.message && msg.message.startsWith('[VOICE]:')) {
    const audioUrl = msg.message.replace('[VOICE]:', '').trim();
    bubble.innerHTML = `<div style="font-size:11px; opacity:0.7; margin-bottom:4px;">🎤 Voice Message</div><audio controls src="${audioUrl}"></audio>`;
  } else {
    const safeMsg = document.createElement('span');
    safeMsg.innerText = msg.message;
    bubble.appendChild(safeMsg);
  }

  wrap.appendChild(label);
  wrap.appendChild(bubble);
  container.appendChild(wrap);
  container.scrollTop = container.scrollHeight;
}

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const message = input?.value.trim();
  if (!message || !currentChatBusId) return;
  
  const session = JSON.parse(localStorage.getItem('userSession'));
  const token = session?.token;
  
  input.value = '';
  
  try {
    await fetch(`${BACKEND_URL}/api/chat/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ bus_id: currentChatBusId, message })
    });
  } catch (err) {
    console.error('Failed to send message', err);
  }
}

// ============================================================================
// VOICE MESSAGING
// ============================================================================
async function startVoiceRecording(e) {
  e.preventDefault();
  if (isRecording) return;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) audioChunks.push(event.data);
    };

    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      stream.getTracks().forEach(track => track.stop());
      await uploadAndSendVoice(audioBlob);
    };

    mediaRecorder.start();
    isRecording = true;
    
    const micBtn = document.getElementById('chat-mic-btn');
    const recordingBar = document.getElementById('chat-recording-bar');
    if (micBtn) micBtn.classList.add('recording');
    if (recordingBar) recordingBar.style.display = 'flex';
  } catch (err) {
    console.error('Microphone access denied:', err);
    alert('Microphone access is required to send voice messages.');
  }
}

function stopVoiceRecording() {
  if (!isRecording || !mediaRecorder) return;
  isRecording = false;
  mediaRecorder.stop();
  
  const micBtn = document.getElementById('chat-mic-btn');
  const recordingBar = document.getElementById('chat-recording-bar');
  if (micBtn) micBtn.classList.remove('recording');
  if (recordingBar) recordingBar.style.display = 'none';
}

async function uploadAndSendVoice(audioBlob) {
  if (!currentChatBusId) return;

  const session = JSON.parse(localStorage.getItem('userSession'));
  const token = session?.token;

  try {
    // Upload to Supabase Storage
    const fileName = `voice_${currentChatBusId}_${Date.now()}.webm`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('chat-audio')
      .upload(fileName, audioBlob, { contentType: 'audio/webm', upsert: false });

    if (uploadError) throw uploadError;

    // Get public URL
    const { data: { publicUrl } } = supabase.storage.from('chat-audio').getPublicUrl(fileName);

    // Send the audio URL as a voice message
    await fetch(`${BACKEND_URL}/api/chat/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ bus_id: currentChatBusId, message: `[VOICE]:${publicUrl}` })
    });
  } catch (err) {
    console.error('Failed to upload/send voice message:', err);
    alert('Failed to send voice message. Please check the Supabase storage bucket is set up.');
  }
}

// Legacy Enter key listener (fallback for static HTML chat inputs)
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('chat-input');
  if (input) {
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendChatMessage();
    });
  }
});
