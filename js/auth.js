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
  if (!valid) throw new Error('Only @student.providence.edu.in or @providence.edu.in allowed.');

  // Attempt to sign in with Supabase Auth
  let { data, error } = await supabase.auth.signInWithPassword({
    email: email,
    password: password,
  });

  if (error) {
    throw new Error('Invalid email or password.');
  }


  // Set the session locally for compatibility with other parts of the app
  localStorage.setItem('userSession', JSON.stringify({
    id: data.user.id,
    email: email,
    role: role
  }));

  window.location.href = 'student-dashboard.html';
}

async function handleStudentSignup(email, password) {
  const { valid, role } = validateEmailDomain(email);
  if (!valid) throw new Error('Only @student.providence.edu.in or @providence.edu.in allowed.');

  const { data, error } = await supabase.auth.signUp({
    email: email,
    password: password,
  });

  if (error) {
    if (error.message.includes('already registered')) {
        throw new Error('You already have an account! Please click Sign In instead.');
    }
    throw new Error(error.message);
  }

  if (!data.session) {
    throw new Error('Account created! Please check your email to confirm your account.');
  }

  localStorage.setItem('userSession', JSON.stringify({
    id: data.user.id,
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
