// Email domain restrictions have been completely removed. Anyone with a verified Google account can sign in
// ============================================================================
// FRONTEND AUTHORIZATION - UI VISIBILITY ONLY
// ============================================================================
// Frontend should NEVER make actual authorization decisions
// Backend always validates roles

const showUIForRole = (role) => {
  // Hide all role-specific UI first
  document.querySelectorAll('[data-role]').forEach(el => {
    el.style.display = 'none';
  });

  // Show only UI for current role
  document.querySelectorAll(`[data-role="${role}"]`).forEach(el => {
    el.style.display = 'block';
  });


};


window._actualHandleGoogleSignIn = async function(response) {
  const errBanner = document.getElementById('error-banner');
  if (errBanner) {
    errBanner.classList.add('hidden');
    errBanner.textContent = '';
  }

  // Add loading UI specifically for Render cold starts
  const loginContainer = document.querySelector('.login-panel-right');
  let originalHtml = '';
  if (loginContainer) {
    originalHtml = loginContainer.innerHTML;
    loginContainer.innerHTML = `
      <div style="text-align:center; padding: 40px; display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%;">
        <i class="fas fa-spinner fa-spin" style="font-size: 40px; color: #2563EB;"></i>
        <h3 style="margin-top:20px; font-weight:800; color:#111827;">Authenticating...</h3>
        <p style="opacity:0.7; font-size:14px; margin-top:10px;">Waking up secure server (this may take up to 45 seconds on first load)...</p>
      </div>
    `;
  }

  try {
    const res = await fetch(`${typeof BACKEND_URL !== 'undefined' ? BACKEND_URL : 'http://localhost:3001'}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Authentication failed');
    }

    // Set the session locally for compatibility with other parts of the app
    localStorage.setItem('userSession', JSON.stringify({
      id: data.user.id,
      email: data.user.email,
      role: data.role,
      token: data.token
    }));

    showUIForRole(data.role);

    window.location.href = 'student-dashboard.html';
  } catch (err) {
    console.error('Google Sign-In Error:', err);
    if (loginContainer && originalHtml) {
      loginContainer.innerHTML = originalHtml;
      // Re-initialize GIS in the restored DOM if needed, 
      // but usually the user will just reload or see the error
    }
    // Note: since we re-rendered the container, errBanner might be a new DOM element or removed.
    // We fetch it again just in case
    const currentErrBanner = document.getElementById('error-banner');
    if (currentErrBanner) {
      currentErrBanner.textContent = err.message;
      currentErrBanner.classList.remove('hidden');
    }
  }
}

async function logout() {
  await supabase.auth.signOut();
  localStorage.clear();
  window.location.href = 'index.html';
}
