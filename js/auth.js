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

async function handleStudentLogin(email, password) {
  const { valid, role } = validateEmailDomain(email);
  if (!valid) {
    throw new Error('Only @student.providence.edu.in or @providence.edu.in allowed.');
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) throw error;

  // Check if profile exists, if not create one
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', data.user.id)
    .single();

  if (!profile) {
    await supabase.from('profiles').insert({
      id: data.user.id,
      email: email,
      role: role
    });
  }

  localStorage.setItem('userSession', JSON.stringify({
    id: data.user.id,
    email: email,
    role: role
  }));

  window.location.href = 'student-dashboard.html';
}

function logout() {
  supabase.auth.signOut();
  localStorage.clear();
  window.location.href = 'index.html';
}
