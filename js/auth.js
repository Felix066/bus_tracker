const ALLOWED_DOMAINS = {
  student: 'student.providence.edu.in',
  faculty: 'providence.edu.in'
};

function validateEmailDomain(email) {
  const domain = email.split('@')[1];
  if (domain === ALLOWED_DOMAINS.student) return { valid: true, role: 'student' };
  if (domain === ALLOWED_DOMAINS.faculty)  return { valid: true, role: 'faculty' };
  return { valid: false, role: null };
}

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

  console.log('UI updated for role:', role);
};


async function handleStudentLogin(email, password) {
  const { valid, role } = validateEmailDomain(email);
  if (!valid) throw new Error('Only @student.providence.edu.in or @providence.edu.in allowed.');

  // Attempt to sign in with Supabase Auth
  let { data, error } = await supabase.auth.signInWithPassword({
    email: email,
    password: password,
  });

  if (error) {
    throw new Error('Invalid email or password. Auto-registration is disabled. Please use an invitation link.');
  }

  // Set the session locally for compatibility with other parts of the app
  localStorage.setItem('userSession', JSON.stringify({
    id: data.user.id,
    email: email,
    role: role
  }));

  showUIForRole(role);

  window.location.href = 'student-dashboard.html';
}

async function logout() {
  await supabase.auth.signOut();
  localStorage.clear();
  window.location.href = 'index.html';
}
