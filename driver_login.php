<?php
// ============================================================
// driver_login.php — Driver login page (GET + POST)
// ============================================================
require_once 'config.php';

// Already logged-in drivers go straight to their page
if (isset($_SESSION['role']) && $_SESSION['role'] === 'driver') {
    header('Location: driver_gps.php');
    exit;
}

$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = trim($_POST['username'] ?? '');
    $password = $_POST['password'] ?? '';

    if ($username === '' || $password === '') {
        $error = 'Please enter your username and password.';
    } else {
        $conn = getDBConnection();
        $stmt = $conn->prepare(
            'SELECT driver_id, password, full_name, bus_id FROM drivers WHERE username = ?'
        );
        $stmt->bind_param('s', $username);
        $stmt->execute();
        $result = $stmt->get_result();
        $row    = $result->fetch_assoc();
        $stmt->close();

        if ($row && password_verify($password, $row['password'])) {
            // Fetch bus info
            $stmt2 = $conn->prepare('SELECT bus_name, route FROM buses WHERE bus_id = ?');
            $stmt2->bind_param('i', $row['bus_id']);
            $stmt2->execute();
            $bus = $stmt2->get_result()->fetch_assoc();
            $stmt2->close();
            $conn->close();

            session_regenerate_id(true);
            $_SESSION['role']      = 'driver';
            $_SESSION['driver_id'] = $row['driver_id'];
            $_SESSION['full_name'] = $row['full_name'];
            $_SESSION['bus_id']    = $row['bus_id'];
            $_SESSION['bus_name']  = $bus['bus_name'] ?? 'Unknown Bus';
            $_SESSION['route']     = $bus['route']    ?? 'Unknown Route';

            header('Location: driver_gps.php');
            exit;
        } else {
            $conn->close();
            $error = 'Invalid username or password. Please try again.';
        }
    }
}
?><!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Driver Login — BusTrack</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --white:         #ffffff;
      --off:           #f8f7f4;
      --cream:         #f2efe8;
      --border:        #e4dfd5;
      --border2:       #d4cfc5;
      --text:          #1a1714;
      --text2:         #6b6560;
      --text3:         #a09890;
      --accent:        #1a56db;
      --accent-light:  #eef3ff;
      --success:       #0e9f6e;
      --success-light: #ecfdf5;
      --danger:        #e02424;
      --warning:       #c27803;
      --gold-light:    #fefce8;
      --shadow-sm:     0 1px 3px rgba(26,23,20,.06), 0 1px 2px rgba(26,23,20,.04);
      --shadow-md:     0 4px 16px rgba(26,23,20,.08), 0 2px 6px rgba(26,23,20,.04);
      --shadow-lg:     0 12px 40px rgba(26,23,20,.10), 0 4px 12px rgba(26,23,20,.06);
      --font:          'Geist', sans-serif;
      --serif:         'Instrument Serif', serif;
      --mono:          'Geist Mono', monospace;
    }

    body {
      font-family: var(--font);
      background: var(--off);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }

    @keyframes pulse  { 0%,100%{opacity:1} 50%{opacity:.35} }
    @keyframes fadeUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
    @keyframes spin   { to{transform:rotate(360deg)} }

    /* ── card wrapper ── */
    .login-card {
      display: flex;
      width: 100%;
      max-width: 980px;
      border-radius: 20px;
      overflow: hidden;
      box-shadow: var(--shadow-lg);
      animation: fadeUp .45s ease both;
    }

    /* ── left panel ── */
    .left {
      width: 38%;
      background: linear-gradient(160deg, #1a3a6e, #1a56db);
      padding: 52px 44px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      flex-shrink: 0;
    }

    .logo {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .logo-icon {
      width: 36px;
      height: 36px;
      background: rgba(255,255,255,.15);
      border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
    }
    .logo-icon svg { width: 20px; height: 20px; }
    .logo-word {
      font-family: var(--font);
      font-weight: 700;
      font-size: 1.1rem;
      color: #fff;
      letter-spacing: -.02em;
    }

    .left-body { margin-top: 48px; }
    .left-headline {
      font-family: var(--serif);
      font-style: italic;
      font-size: 2.1rem;
      color: #fff;
      line-height: 1.25;
      margin-bottom: 16px;
    }
    .left-sub {
      font-size: .88rem;
      color: rgba(255,255,255,.62);
      line-height: 1.65;
    }

    .left-stats {
      display: flex;
      gap: 24px;
      margin-top: 40px;
    }
    .stat { text-align: left; }
    .stat-val {
      font-family: var(--font);
      font-weight: 700;
      font-size: 1.05rem;
      color: #fff;
    }
    .stat-label {
      font-family: var(--mono);
      font-size: .62rem;
      color: rgba(255,255,255,.55);
      letter-spacing: .08em;
      text-transform: uppercase;
      margin-top: 3px;
    }

    /* ── right panel ── */
    .right {
      width: 62%;
      background: var(--white);
      padding: 52px 48px;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }

    .portal-label {
      font-family: var(--mono);
      font-size: .67rem;
      letter-spacing: .10em;
      text-transform: uppercase;
      color: var(--text3);
      margin-bottom: 10px;
    }
    .right h1 {
      font-size: 1.7rem;
      font-weight: 700;
      color: var(--text);
      letter-spacing: -.03em;
      margin-bottom: 6px;
    }
    .right-sub {
      font-size: .88rem;
      color: var(--text2);
      margin-bottom: 32px;
      line-height: 1.6;
    }

    .form-group { margin-bottom: 18px; }
    .form-group label {
      display: block;
      font-size: .8rem;
      font-weight: 600;
      color: var(--text);
      margin-bottom: 6px;
      letter-spacing: -.01em;
    }
    .input-wrap {
      position: relative;
    }
    .input-wrap .icon {
      position: absolute;
      left: 13px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text3);
      pointer-events: none;
    }
    .input-wrap input {
      width: 100%;
      background: var(--off);
      border: 1.5px solid var(--border2);
      border-radius: 10px;
      padding: 12px 14px 12px 40px;
      font-family: var(--font);
      font-size: .9rem;
      color: var(--text);
      outline: none;
      transition: border .15s, background .15s, box-shadow .15s;
    }
    .input-wrap input:focus {
      border-color: var(--accent);
      background: var(--white);
      box-shadow: 0 0 0 3px rgba(26,86,219,.10);
    }
    .pw-toggle {
      position: absolute;
      right: 12px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      cursor: pointer;
      color: var(--text3);
      padding: 4px;
      display: flex;
      align-items: center;
    }
    .pw-toggle:hover { color: var(--text2); }

    .hint-box {
      background: var(--gold-light);
      border: 1px solid #fde68a;
      border-radius: 10px;
      padding: 12px 16px;
      margin-bottom: 20px;
    }
    .hint-label {
      font-family: var(--mono);
      font-size: .67rem;
      font-weight: 600;
      color: var(--warning);
      letter-spacing: .08em;
      text-transform: uppercase;
      margin-bottom: 5px;
    }
    .hint-creds {
      font-family: var(--mono);
      font-size: .78rem;
      color: var(--text2);
      line-height: 1.7;
    }

    .btn-primary {
      display: block;
      width: 100%;
      background: var(--text);
      color: var(--white);
      border: none;
      border-radius: 10px;
      padding: 13px 24px;
      font-family: var(--font);
      font-size: .92rem;
      font-weight: 600;
      cursor: pointer;
      letter-spacing: -.01em;
      transition: background .15s, transform .15s, box-shadow .15s;
    }
    .btn-primary:hover {
      background: #2d2a26;
      transform: translateY(-1px);
      box-shadow: var(--shadow-md);
    }

    .error-box {
      background: #fff1f1;
      border: 1px solid #fca5a5;
      border-radius: 10px;
      padding: 12px 16px;
      margin-bottom: 18px;
      font-size: .87rem;
      color: var(--danger);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .form-footer {
      margin-top: 24px;
      font-size: .83rem;
      color: var(--text3);
      text-align: center;
    }
    .form-footer a {
      color: var(--accent);
      text-decoration: none;
      font-weight: 500;
    }
    .form-footer a:hover { text-decoration: underline; }

    @media (max-width: 680px) {
      .login-card { flex-direction: column; }
      .left, .right { width: 100%; }
      .left { padding: 36px 28px; }
      .right { padding: 36px 28px; }
      .left-headline { font-size: 1.65rem; }
      .left-stats { gap: 16px; }
    }
  </style>
</head>
<body>

<div class="login-card">
  <!-- LEFT -->
  <div class="left">
    <div>
      <div class="logo">
        <div class="logo-icon">
          <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="2" y="6" width="16" height="10" rx="3" fill="white"/>
            <circle cx="6" cy="16" r="2" fill="white"/>
            <circle cx="14" cy="16" r="2" fill="white"/>
            <rect x="5" y="3" width="10" height="5" rx="1.5" fill="rgba(255,255,255,0.55)"/>
          </svg>
        </div>
        <span class="logo-word">BusTrack</span>
      </div>
      <div class="left-body">
        <div class="left-headline">Track every bus,<br>in real time.</div>
        <div class="left-sub">Professional fleet management for schools and institutions.</div>
      </div>
    </div>
    <div class="left-stats">
      <div class="stat">
        <div class="stat-val">3 sec</div>
        <div class="stat-label">Location updates</div>
      </div>
      <div class="stat">
        <div class="stat-val">Live</div>
        <div class="stat-label">GPS tracking</div>
      </div>
      <div class="stat">
        <div class="stat-val">Free</div>
        <div class="stat-label">OpenStreetMap</div>
      </div>
    </div>
  </div>

  <!-- RIGHT -->
  <div class="right">
    <div class="portal-label">Driver Portal</div>
    <h1>Welcome back</h1>
    <p class="right-sub">Sign in with your driver credentials to begin your shift.</p>

    <?php if ($error): ?>
    <div class="error-box">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="7.5" stroke="#e02424"/>
        <path d="M8 4.5v4m0 2.5h.01" stroke="#e02424" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <?php echo htmlspecialchars($error); ?>
    </div>
    <?php endif; ?>

    <form method="POST" action="driver_login.php" autocomplete="off" novalidate>
      <div class="form-group">
        <label for="username">Username</label>
        <div class="input-wrap">
          <span class="icon">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="5.5" r="2.5" stroke="currentColor" stroke-width="1.4"/>
              <path d="M2 13c0-2.761 2.686-5 6-5s6 2.239 6 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            </svg>
          </span>
          <input
            type="text" id="username" name="username"
            placeholder="e.g. driver1"
            value="<?php echo htmlspecialchars($_POST['username'] ?? ''); ?>"
            autocomplete="username"
            required
          />
        </div>
      </div>

      <div class="form-group">
        <label for="password">Password</label>
        <div class="input-wrap">
          <span class="icon">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="3" y="7" width="10" height="7" rx="2" stroke="currentColor" stroke-width="1.4"/>
              <path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            </svg>
          </span>
          <input type="password" id="password" name="password" placeholder="••••••••" autocomplete="current-password" required />
          <button type="button" class="pw-toggle" id="pwToggle" aria-label="Show password">
            <svg id="eyeIcon" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <ellipse cx="8" cy="8" rx="5.5" ry="4" stroke="currentColor" stroke-width="1.4"/>
              <circle cx="8" cy="8" r="1.5" fill="currentColor"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="hint-box">
        <div class="hint-label">Demo Credentials</div>
        <div class="hint-creds">driver1 / password123<br>driver2 / password123</div>
      </div>

      <button type="submit" class="btn-primary">Sign in →</button>
    </form>

    <div class="form-footer">
      Are you a student? <a href="student_login.php">Sign in here →</a>
    </div>
  </div>
</div>

<script>
  const pwToggle = document.getElementById('pwToggle');
  const pwInput  = document.getElementById('password');
  pwToggle.addEventListener('click', function() {
    const show = pwInput.type === 'password';
    pwInput.type = show ? 'text' : 'password';
    document.getElementById('eyeIcon').innerHTML = show
      ? '<line x1="2" y1="2" x2="14" y2="14" stroke="currentColor" stroke-width="1.4"/><ellipse cx="8" cy="8" rx="5.5" ry="4" stroke="currentColor" stroke-width="1.4"/>'
      : '<ellipse cx="8" cy="8" rx="5.5" ry="4" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/>';
  });
</script>

</body>
</html>
