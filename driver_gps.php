<?php
// ============================================================
// driver_gps.php — Driver GPS broadcasting page
// ============================================================
require_once 'config.php';

if (empty($_SESSION['role']) || $_SESSION['role'] !== 'driver') {
    header('Location: driver_login.php');
    exit;
}

$full_name = htmlspecialchars($_SESSION['full_name'] ?? 'Driver');
$bus_name  = htmlspecialchars($_SESSION['bus_name']  ?? 'Bus');
$route     = htmlspecialchars($_SESSION['route']     ?? '');
$bus_id    = (int)($_SESSION['bus_id'] ?? 0);
// Short label: "Bus 1" → "B1", "Bus 2" → "B2", etc.
$bus_label = preg_replace('/[^0-9]/', '', $bus_name);
$bus_label = 'B' . ($bus_label !== '' ? $bus_label : $bus_id);

// Fetch latest coords for initial map centering
$conn = getDBConnection();
$stmt = $conn->prepare('SELECT latitude, longitude FROM buses WHERE bus_id = ?');
$stmt->bind_param('i', $bus_id);
$stmt->execute();
$busRow = $stmt->get_result()->fetch_assoc();
$stmt->close();
$conn->close();

$initLat = (float)($busRow['latitude']  ?? 14.5995);
$initLng = (float)($busRow['longitude'] ?? 120.9842);
?><!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title><?php echo $bus_name; ?> — Driver Console · BusTrack</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
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
    @keyframes spin   { to{transform:rotate(360deg)} }
    @keyframes livering {
      0%   { transform: scale(1);   opacity: .8; }
      100% { transform: scale(2.2); opacity: 0; }
    }

    body {
      font-family: var(--font);
      background: var(--off);
      min-height: 100vh;
    }

    /* ── Navbar ── */
    .navbar {
      position: sticky; top: 0; z-index: 200;
      background: var(--white);
      border-bottom: 1px solid var(--border);
      height: 64px;
      display: flex; align-items: center;
      padding: 0 28px;
      gap: 16px;
    }
    .nav-logo { display: flex; align-items: center; gap: 10px; text-decoration: none; }
    .nav-logo-icon {
      width: 32px; height: 32px;
      background: var(--accent);
      border-radius: 9px;
      display: flex; align-items: center; justify-content: center;
    }
    .nav-logo-icon svg { width: 18px; height: 18px; }
    .nav-logo-word { font-weight: 700; font-size: 1rem; color: var(--text); letter-spacing: -.02em; }

    .nav-center { flex: 1; display: flex; justify-content: center; }
    .bus-chip {
      background: var(--accent-light);
      color: var(--accent);
      border: 1px solid rgba(26,86,219,.18);
      border-radius: 100px;
      padding: 5px 14px;
      font-size: .8rem;
      font-weight: 600;
      letter-spacing: -.01em;
      white-space: nowrap;
    }

    .nav-right { display: flex; align-items: center; gap: 12px; margin-left: auto; }
    .nav-name { font-size: .85rem; color: var(--text2); }
    .btn-logout {
      background: none; border: 1.5px solid var(--border2);
      border-radius: 8px; padding: 6px 14px;
      font-family: var(--font); font-size: .82rem; font-weight: 500;
      color: var(--text2); cursor: pointer;
      transition: background .15s, border-color .15s;
    }
    .btn-logout:hover { background: var(--off); border-color: var(--border2); }

    /* ── Main layout ── */
    .main { max-width: 680px; margin: 0 auto; padding: 40px 24px 60px; }

    /* ── Card ── */
    .card {
      background: var(--white);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      box-shadow: var(--shadow-sm);
      margin-bottom: 20px;
      animation: fadeUp .4s ease both;
    }
    .card:nth-child(2) { animation-delay: .05s; }
    .card:nth-child(3) { animation-delay: .10s; }

    .card-title {
      font-size: .95rem;
      font-weight: 700;
      color: var(--text);
      letter-spacing: -.02em;
      margin-bottom: 4px;
    }
    .card-sub {
      font-size: .83rem;
      color: var(--text2);
      line-height: 1.55;
      margin-bottom: 16px;
    }

    /* ── Status card ── */
    .driver-info {
      display: flex; align-items: center; gap: 14px;
      margin-bottom: 14px;
    }
    .driver-avatar {
      width: 44px; height: 44px;
      background: var(--accent-light);
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-weight: 700; font-size: .95rem; color: var(--accent);
      flex-shrink: 0;
    }
    .driver-name { font-weight: 600; font-size: .95rem; color: var(--text); }
    .driver-bus  { font-size: .82rem; color: var(--text2); margin-top: 1px; }

    /* Badges */
    .badge-offline {
      display: inline-flex; align-items: center; gap: 6px;
      background: var(--off); border: 1px solid var(--border2);
      color: var(--text3); border-radius: 100px; padding: 4px 12px;
      font-family: var(--mono); font-size: .68rem; font-weight: 500;
    }
    .badge-live {
      display: inline-flex; align-items: center; gap: 6px;
      background: var(--success-light); border: 1px solid #a7f3d0;
      color: var(--success); border-radius: 100px; padding: 4px 12px;
      font-family: var(--mono); font-size: .68rem; font-weight: 600;
    }
    .badge-live::before {
      content: '';
      display: inline-block; width: 7px; height: 7px;
      background: var(--success); border-radius: 50%;
      animation: pulse 1.5s ease infinite;
    }

    /* ── Broadcast card ── */
    .control-center {
      display: flex; flex-direction: column; align-items: center;
      gap: 16px; padding: 8px 0;
    }

    /* Ring animation around bus icon */
    .live-icon-wrap {
      position: relative;
      width: 72px; height: 72px;
      display: flex; align-items: center; justify-content: center;
    }
    .live-ring {
      position: absolute;
      inset: 0; border-radius: 50%;
      border: 2.5px solid var(--success);
      opacity: 0;
      animation: livering 1.8s ease-out infinite;
    }
    .live-ring:nth-child(2) { animation-delay: .6s; }
    .live-ring:nth-child(3) { animation-delay: 1.2s; }
    .live-icon-core {
      width: 56px; height: 56px;
      background: var(--success-light);
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      border: 2px solid #a7f3d0;
    }
    .live-icon-core svg { width: 26px; height: 26px; color: var(--success); }

    .coords-display {
      font-family: var(--mono);
      font-size: .88rem;
      font-weight: 500;
      color: var(--accent);
      text-align: center;
      background: var(--accent-light);
      padding: 8px 18px;
      border-radius: 8px;
      border: 1px solid rgba(26,86,219,.12);
      min-width: 240px;
    }
    .coords-label {
      font-family: var(--mono);
      font-size: .63rem;
      color: var(--text3);
      letter-spacing: .09em;
      text-transform: uppercase;
      text-align: center;
      margin-bottom: 2px;
    }

    .status-line {
      font-size: .85rem;
      color: var(--text2);
      text-align: center;
    }

    .btn-start {
      display: inline-flex; align-items: center; gap: 8px;
      background: var(--text); color: var(--white);
      border: none; border-radius: 10px;
      padding: 13px 28px;
      font-family: var(--font); font-size: .92rem; font-weight: 600;
      cursor: pointer; letter-spacing: -.01em;
      transition: background .15s, transform .15s, box-shadow .15s;
    }
    .btn-start:hover { background: #2d2a26; transform: translateY(-1px); box-shadow: var(--shadow-md); }

    .btn-stop {
      display: inline-flex; align-items: center; gap: 8px;
      background: #fff1f1; border: 1.5px solid #fca5a5;
      color: var(--danger); border-radius: 10px;
      padding: 12px 28px;
      font-family: var(--font); font-size: .92rem; font-weight: 600;
      cursor: pointer;
      transition: background .15s;
    }
    .btn-stop:hover { background: #fee2e2; }

    .error-msg {
      font-size: .84rem;
      color: var(--danger);
      text-align: center;
      padding: 8px 16px;
      background: #fff1f1;
      border-radius: 8px;
      border: 1px solid #fca5a5;
    }

    /* ── Map card ── */
    #map {
      width: 100%;
      height: 380px;
      border-radius: 10px;
      overflow: hidden;
      border: 1px solid var(--border);
    }

    /* Custom bus pin */
    .bus-pin {
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .bus-pin-head {
      width: 38px; height: 38px;
      background: var(--accent);
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 3px 10px rgba(26,86,219,.45);
      border: 2.5px solid #fff;
    }
    .bus-pin-label {
      transform: rotate(45deg);
      font-family: var(--mono);
      font-size: .65rem;
      font-weight: 700;
      color: #fff;
      letter-spacing: -.01em;
    }
    .bus-pin-tail {
      width: 3px; height: 10px;
      background: var(--accent);
      border-radius: 0 0 3px 3px;
    }
  </style>
</head>
<body>

<!-- Navbar -->
<nav class="navbar">
  <a href="driver_gps.php" class="nav-logo">
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
  <div class="nav-center">
    <div class="bus-chip"><?php echo $bus_name; ?></div>
  </div>
  <div class="nav-right">
    <span class="nav-name">Driver Dashboard</span>
    <a href="logout.php"><button class="btn-logout">Logout</button></a>
  </div>
</nav>

<div class="main">

  <!-- Card 1: Status -->
  <div class="card">
    <div class="driver-info">
      <div class="driver-avatar"><?php echo strtoupper(substr($_SESSION['full_name'] ?? 'D', 0, 1)); ?></div>
      <div>
        <div class="driver-name">Driver Console</div>
        <div class="driver-bus"><?php echo $bus_name; ?></div>
      </div>
    </div>
    <div id="statusBadge" class="badge-offline">Idle · Not Broadcasting</div>
  </div>

  <!-- Card 2: Broadcast Control -->
  <div class="card">
    <div class="card-title">Location Sharing</div>
    <p class="card-sub">Share your real-time position so passengers can see exactly where your bus is on the map.</p>

    <div class="control-center">
      <!-- Idle state -->
      <div id="idleState">
        <button class="btn-start" id="btnStart" onclick="startSharing()">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="7.5" stroke="currentColor" stroke-width="1.4"/>
            <path d="M6.5 5.5l4 2.5-4 2.5V5.5z" fill="currentColor"/>
          </svg>
          Start Sharing Location
        </button>
      </div>

      <!-- Active state -->
      <div id="activeState" style="display:none; width:100%; display:none; flex-direction:column; align-items:center; gap:14px;">
        <div class="live-icon-wrap">
          <div class="live-ring"></div>
          <div class="live-ring"></div>
          <div class="live-ring"></div>
          <div class="live-icon-core">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <rect x="1" y="7" width="16" height="12" rx="3"/>
              <circle cx="5" cy="19" r="2"/>
              <circle cx="13" cy="19" r="2"/>
              <path d="M5 7V5a4 4 0 0 1 4-4h2a4 4 0 0 1 4 4v2"/>
              <line x1="19" y1="9" x2="23" y2="9"/>
              <line x1="19" y1="13" x2="23" y2="13"/>
            </svg>
          </div>
        </div>
        <div>
          <div class="coords-label">Current Position</div>
          <div class="coords-display" id="coordsDisplay">— Waiting for GPS —</div>
        </div>
        <div class="status-line" id="statusLine">Your position is visible to passengers on the live map.</div>
        <div id="gpsError" class="error-msg" style="display:none;"></div>
        <button class="btn-stop" onclick="stopSharing()">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="2" y="2" width="10" height="10" rx="2" fill="currentColor"/>
          </svg>
          Stop Sharing
        </button>
      </div>
    </div>
  </div>

  <!-- Card 3: Mini Map -->
  <div class="card">
    <div class="card-title" style="margin-bottom:14px;">Your Position</div>
    <div id="map"></div>
  </div>

</div><!-- /main -->

<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
// ── Map init ──
var map = L.map('map', { zoomControl: true }).setView([<?php echo $initLat; ?>, <?php echo $initLng; ?>], 16);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19
}).addTo(map);

// ── Custom bus pin icon ──
var busLabel = '<?php echo $bus_label; ?>';
var pinHtml  = '<div class="bus-pin">'
  + '<div class="bus-pin-head"><span class="bus-pin-label">' + busLabel + '</span></div>'
  + '<div class="bus-pin-tail"></div>'
  + '</div>';
var busIcon = L.divIcon({
  html: pinHtml,
  className: '',
  iconSize:   [38, 52],
  iconAnchor: [19, 52],
  popupAnchor:[0, -54]
});

var marker = L.marker([<?php echo $initLat; ?>, <?php echo $initLng; ?>], { icon: busIcon }).addTo(map);
marker.bindPopup('<b>' + busLabel + '</b> — <?php echo $bus_name; ?>');

// ── GPS sharing state ──
var watchId     = null;
var isSharing   = false;

var idleState   = document.getElementById('idleState');
var activeState = document.getElementById('activeState');
var statusBadge = document.getElementById('statusBadge');
var coordsDisp  = document.getElementById('coordsDisplay');
var gpsError    = document.getElementById('gpsError');

function showActiveUI() {
  idleState.style.display   = 'none';
  activeState.style.display = 'flex';
  statusBadge.className = 'badge-live';
  statusBadge.textContent = 'Broadcasting Live';
}

function showIdleUI() {
  idleState.style.display   = 'block';
  activeState.style.display = 'none';
  statusBadge.className = 'badge-offline';
  statusBadge.textContent = 'Idle · Not Broadcasting';
  coordsDisp.textContent = '— Waiting for GPS —';
  gpsError.style.display = 'none';
}

function updateMapMarker(lat, lng) {
  marker.setLatLng([lat, lng]);
  map.setView([lat, lng], map.getZoom());
}

function showCoordinates(lat, lng) {
  coordsDisp.textContent =
    lat.toFixed(6) + '°, ' + lng.toFixed(6) + '°';
}

function sendLocation(lat, lng) {
  fetch('update_location.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ latitude: lat, longitude: lng })
  }).catch(function() {});
}

function startSharing() {
  if (!navigator.geolocation) {
    alert('Geolocation is not supported by your browser.');
    return;
  }
  showActiveUI();
  gpsError.style.display = 'none';

  function onGPSSuccess(position) {
    gpsError.style.display = 'none';
    var lat = position.coords.latitude;
    var lng = position.coords.longitude;
    sendLocation(lat, lng);
    updateMapMarker(lat, lng);
    showCoordinates(lat, lng);
  }

  function onGPSError(err) {
    gpsError.style.display = 'block';
    gpsError.textContent   = 'Location error: ' + err.message;
    // Fallback: If High Accuracy times out, try once with normal accuracy
    if (err.code === err.TIMEOUT && options.enableHighAccuracy) {
      console.warn('GPS timeout, retrying with normal accuracy...');
      options.enableHighAccuracy = false;
      options.timeout = 10000;
      navigator.geolocation.clearWatch(watchId);
      watchId = navigator.geolocation.watchPosition(onGPSSuccess, onGPSError, options);
    }
  }

  var options = { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 };
  watchId = navigator.geolocation.watchPosition(onGPSSuccess, onGPSError, options);
}

function stopSharing() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  fetch('update_location.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_active: 0 })
  }).catch(function() {});
  showIdleUI();
}

// Clean up on page leave
window.addEventListener('beforeunload', function() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    fetch('update_location.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: 0 }),
      keepalive: true
    });
  }
});
</script>

</body>
</html>
