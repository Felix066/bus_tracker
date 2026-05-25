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
    if (error.message.includes('Invalid login credentials')) {
      // User might not exist yet. Attempt auto-registration.
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: email,
        password: password,
      });

      if (signUpError) {
        if (signUpError.message.includes('already registered')) {
          // If they are already registered, it means their password was wrong!
          throw new Error('Invalid email or password.');
        }
        throw new Error(signUpError.message);
      }
      
      // If sign up succeeded but no session is returned, email confirmation might be enabled
      if (!signUpData.session) {
        throw new Error('Registration successful! Please check your email to confirm your account before logging in.');
      }
      
      data = signUpData;
    } else if (error.message.includes('Email not confirmed')) {
      throw new Error('Please confirm your email address before logging in.');
    } else {
      throw new Error(error.message);
    }
  }

  // Set the session locally for compatibility with other parts of the app
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
