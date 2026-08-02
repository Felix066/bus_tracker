// js/chat.js
let chatSubscription = null;
let currentChatBusId = null;
let isChatOpen = false;

function toggleChat() {
  const panel = document.getElementById('chat-panel');
  const badge = document.getElementById('chat-badge');
  isChatOpen = !isChatOpen;
  
  if (isChatOpen) {
    panel.style.display = 'flex';
    if(badge) badge.style.display = 'none';
    const msgContainer = document.getElementById('chat-messages');
    msgContainer.scrollTop = msgContainer.scrollHeight;
  } else {
    panel.style.display = 'none';
  }
}

async function initChat(busId, userRole) {
  currentChatBusId = busId;
  window.chatUserRole = userRole;
  
  // Fetch existing messages
  const session = JSON.parse(localStorage.getItem(userRole === 'admin' ? 'adminSession' : 'driverSession'));
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
        container.innerHTML = `<div style="text-align:center; color:#94a3b8; font-size:12px; margin-top:20px;">No messages yet.</div>`;
      } else {
        data.messages.forEach(msg => appendMessage(msg));
      }
    }
  } catch (err) {
    console.error('Error fetching chat history', err);
  }

  // Subscribe to new messages
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
}

function appendMessage(msg) {
  const container = document.getElementById('chat-messages');
  
  // Remove "No messages" text if present
  if (container.innerHTML.includes('No messages yet')) {
    container.innerHTML = '';
  }

  const isMine = msg.sender_role === window.chatUserRole;
  const time = new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
  
  const div = document.createElement('div');
  div.style.display = 'flex';
  div.style.flexDirection = 'column';
  div.style.alignItems = isMine ? 'flex-end' : 'flex-start';
  div.style.maxWidth = '85%';
  div.style.alignSelf = isMine ? 'flex-end' : 'flex-start';
  
  const roleLabel = isMine ? 'You' : (msg.sender_role === 'admin' ? 'Dispatcher' : 'Driver');
  
  // Sanitize
  const safeMsg = document.createElement('div');
  safeMsg.innerText = msg.message;
  
  div.innerHTML = `
    <span style="font-size:10px; color:#94a3b8; margin-bottom:2px; padding:0 4px;">${roleLabel} • ${time}</span>
    <div style="background:${isMine ? '#4f46e5' : '#f1f5f9'}; color:${isMine ? 'white' : '#0f172a'}; padding:10px 14px; border-radius:${isMine ? '14px 14px 2px 14px' : '14px 14px 14px 2px'}; box-shadow:0 2px 5px rgba(0,0,0,0.05); word-wrap:break-word;">
      ${safeMsg.innerHTML}
    </div>
  `;
  
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message || !currentChatBusId) return;
  
  const session = JSON.parse(localStorage.getItem(window.chatUserRole === 'admin' ? 'adminSession' : 'driverSession'));
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

// Enable Enter key to send
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('chat-input');
  if (input) {
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendChatMessage();
    });
  }
});
