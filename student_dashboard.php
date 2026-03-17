<?php
// ============================================================
// student_dashboard.php — Student bus selection dashboard
// ============================================================
require_once 'config.php';

if (empty($_SESSION['role']) || $_SESSION['role'] !== 'student') {
    header('Location: student_login.php');
    exit;
}

$full_name = htmlspecialchars($_SESSION['full_name'] ?? 'Student');

$conn  = getDBConnection();
$res   = $conn->query(
    'SELECT bus_id, bus_name, route, is_active, last_updated FROM buses ORDER BY bus_id'
);
$buses = $res->fetch_all(MYSQLI_ASSOC);
$conn->close();
?><!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Choose Your Bus — BusTrack</title>
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

    @keyframes pulse  { 0%,100%{opacity:1} 50%{opacity:.35} }
    @keyframes fadeUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }

    body { font-family: var(--font); background: var(--off); min-height: 100vh; }

    /* ── Navbar ── */
    .navbar {
      position: sticky; top: 0; z-index: 100;
      background: var(--white); border-bottom: 1px solid var(--border);
      height: 64px; display: flex; align-items: center;
      padding: 0 28px; gap: 16px;
    }
    .nav-logo { display: flex; align-items: center; gap: 10px; text-decoration: none; }
    .nav-logo-icon {
      width: 32px; height: 32px; background: var(--accent);
      border-radius: 9px; display: flex; align-items: center; justify-content: center;
    }
    .nav-logo-icon svg { width: 18px; height: 18px; }
    .nav-logo-word { font-weight: 700; font-size: 1rem; color: var(--text); letter-spacing: -.02em; }
    .nav-right { display: flex; align-items: center; gap: 12px; margin-left: auto; }
    .nav-name  { font-size: .85rem; color: var(--text2); }
    .btn-logout {
      background: none; border: 1.5px solid var(--border2);
      border-radius: 8px; padding: 6px 14px;
      font-family: var(--font); font-size: .82rem; font-weight: 500;
      color: var(--text2); cursor: pointer;
      transition: background .15s;
    }
    .btn-logout:hover { background: var(--off); }

    /* ── Header ── */
    .page-header { padding: 40px 32px 0; max-width: 1100px; margin: 0 auto; }
    .page-title {
      font-family: var(--serif); font-style: italic;
      font-size: 2.4rem; color: var(--text); line-height: 1.15;
      margin-bottom: 8px;
    }
    .page-sub { font-size: .9rem; color: var(--text2); line-height: 1.6; }

    /* ── Bus grid ── */
    .bus-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      padding: 32px;
      max-width: 1100px;
      margin: 0 auto;
    }

    /* ── Bus card ── */
    .bus-card {
      background: var(--white);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      box-shadow: var(--shadow-sm);
      cursor: pointer;
      transition: box-shadow .2s, transform .2s;
      animation: fadeUp .4s ease both;
      display: flex; flex-direction: column; gap: 0;
      text-decoration: none; color: inherit;
    }
    .bus-card:nth-child(1) { animation-delay: .00s; }
    .bus-card:nth-child(2) { animation-delay: .06s; }
    .bus-card:nth-child(3) { animation-delay: .12s; }
    .bus-card:hover { box-shadow: var(--shadow-md); transform: translateY(-2px); }

    .bus-card-top {
      display: flex; justify-content: space-between;
      align-items: flex-start; margin-bottom: 14px;
    }
    .bus-icon {
      width: 44px; height: 44px;
      background: var(--off); border: 1px solid var(--border);
      border-radius: 12px; display: flex;
      align-items: center; justify-content: center;
    }
    .bus-icon svg { width: 22px; height: 22px; color: var(--text2); }

    .badge-live {
      display: inline-flex; align-items: center; gap: 6px;
      background: var(--success-light); border: 1px solid #a7f3d0;
      color: var(--success); border-radius: 100px; padding: 4px 12px;
      font-family: var(--mono); font-size: .68rem; font-weight: 600;
    }
    .badge-live::before {
      content: ''; width: 7px; height: 7px;
      background: var(--success); border-radius: 50%;
      animation: pulse 1.5s ease infinite;
    }
    .badge-offline {
      display: inline-flex; align-items: center; gap: 6px;
      background: var(--off); border: 1px solid var(--border2);
      color: var(--text3); border-radius: 100px; padding: 4px 12px;
      font-family: var(--mono); font-size: .68rem; font-weight: 500;
    }

    .bus-name { font-weight: 700; font-size: 1.2rem; color: var(--text); margin-bottom: 4px; }
    .bus-route { font-size: .85rem; color: var(--text2); margin-bottom: 14px; }
    .bus-updated {
      font-family: var(--mono); font-size: .72rem;
      color: var(--text3); margin-bottom: 18px;
    }

    .btn-track-live {
      display: block; width: 100%;
      background: var(--text); color: var(--white);
      border: none; border-radius: 10px;
      padding: 11px 18px; text-align: center;
      font-family: var(--font); font-size: .88rem; font-weight: 600;
      cursor: pointer; letter-spacing: -.01em;
      transition: background .15s, transform .15s;
      text-decoration: none;
    }
    .btn-track-live:hover { background: #2d2a26; transform: translateY(-1px); }

    .btn-track-offline {
      display: block; width: 100%;
      background: var(--white); color: var(--text2);
      border: 1.5px solid var(--border2); border-radius: 10px;
      padding: 10px 18px; text-align: center;
      font-family: var(--font); font-size: .88rem; font-weight: 500;
      cursor: pointer;
      transition: background .15s;
      text-decoration: none;
    }
    .btn-track-offline:hover { background: var(--off); }

    @media (max-width: 860px) {
      .bus-grid { grid-template-columns: repeat(2, 1fr); }
    }
    @media (max-width: 580px) {
      .bus-grid { grid-template-columns: 1fr; padding: 20px; }
      .page-header { padding: 28px 20px 0; }
      .page-title { font-size: 1.9rem; }
    }
  </style>
</head>
<body>

<!-- Navbar -->
<nav class="navbar">
  <a href="student_dashboard.php" class="nav-logo">
    <div class="nav-logo-icon">
      <svg viewBox="0 0 20 20" fill="none">
        <rect x="2" y="6" width="16" height="10" rx="3" fill="white"/>
        <circle cx="6" cy="16" r="2" fill="white"/>
        <circle cx="14" cy="16" r="2" fill="white"/>
        <rect x="5" y="3" width="10" height="5" rx="1.5" fill="rgba(255,255,255,0.5)"/>
      </svg>
    </div>
    <span class="nav-logo-word">BusTrack</span>
  </a>
  <div class="nav-right">
    <span class="nav-name"><?php echo $full_name; ?></span>
    <a href="logout.php"><button class="btn-logout">Logout</button></a>
  </div>
</nav>

<!-- Header -->
<div class="page-header">
  <h1 class="page-title">Choose your bus</h1>
  <p class="page-sub">Select the bus you want to track on the live map.</p>
</div>

<!-- Bus grid -->
<div class="bus-grid">
  <?php foreach ($buses as $bus):
    $isActive   = (int)$bus['is_active'];
    $busId      = (int)$bus['bus_id'];
    $busName    = htmlspecialchars($bus['bus_name']);
    $route      = htmlspecialchars($bus['route']);
    $lastUpdate = $bus['last_updated']
      ? date('M j, g:i A', strtotime($bus['last_updated']))
      : 'Never';
    $href = 'student_map.php?bus_id=' . $busId;
  ?>
  <a href="<?php echo $href; ?>" class="bus-card">
    <div class="bus-card-top">
      <div class="bus-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
          <rect x="1" y="7" width="16" height="11" rx="2.5"/>
          <circle cx="5" cy="18" r="2"/>
          <circle cx="13" cy="18" r="2"/>
          <path d="M5 7V5a3 3 0 0 1 3-3h2a3 3 0 0 1 3 3v2"/>
          <line x1="18" y1="10" x2="22" y2="10"/>
          <line x1="18" y1="14" x2="22" y2="14"/>
        </svg>
      </div>
      <?php if ($isActive): ?>
        <span class="badge-live">Live</span>
      <?php else: ?>
        <span class="badge-offline">Offline</span>
      <?php endif; ?>
    </div>

    <div class="bus-name"><?php echo $busName; ?></div>
    <div class="bus-updated">Last updated: <?php echo $lastUpdate; ?></div>

    <?php if ($isActive): ?>
      <span class="btn-track-live">Track This Bus →</span>
    <?php else: ?>
      <span class="btn-track-offline">Track This Bus →</span>
    <?php endif; ?>
  </a>
  <?php endforeach; ?>
</div>

</body>
</html>
