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


async function handleGoogleSignIn(response) {
  const errBanner = document.getElementById('error-banner');
  if (errBanner) {
    errBanner.classList.add('hidden');
    errBanner.textContent = '';
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
    if (errBanner) {
      errBanner.textContent = err.message;
      errBanner.classList.remove('hidden');
    }
  }
}

async function logout() {
  await supabase.auth.signOut();
  localStorage.clear();
  window.location.href = 'index.html';
}
