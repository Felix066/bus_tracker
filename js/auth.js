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

// Separate Signup flow
async function handleSignup(email, password) {
  const { valid } = validateEmailDomain(email);
  if (!valid) throw new Error('Only @student.providence.edu.in or @providence.edu.in allowed.');

  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  
  alert('Signup successful! You can now log in.');
}

async function handleStudentLogin(email, password) {
  const { valid, role } = validateEmailDomain(email);
  if (!valid) throw new Error('Only @student.providence.edu.in or @providence.edu.in allowed.');

  // Create a mock session directly for any valid email to bypass Supabase setup
  localStorage.setItem('userSession', JSON.stringify({
    id: 'demo-student-1',
    email: email,
    role: role
  }));

  window.location.href = 'student-dashboard.html';
}

async function logout() {
  await supabase.auth.signOut();
  localStorage.clear();
  window.location.href = 'index.html';
}
