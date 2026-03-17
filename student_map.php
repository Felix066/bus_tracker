<?php
// ============================================================
// student_map.php — Full-screen live map for a selected bus
// ============================================================
require_once 'config.php';

if (empty($_SESSION['role']) || $_SESSION['role'] !== 'student') {
    header('Location: student_login.php');
    exit;
}

// Validate bus_id
$bus_id = filter_input(INPUT_GET, 'bus_id', FILTER_VALIDATE_INT);
if (!$bus_id || $bus_id <= 0) {
    header('Location: student_dashboard.php');
    exit;
}

// Fetch bus from DB
$conn = getDBConnection();
$stmt = $conn->prepare(
    'SELECT bus_id, bus_name, route, latitude, longitude, last_updated, is_active
       FROM buses WHERE bus_id = ?'
);
$stmt->bind_param('i', $bus_id);
$stmt->execute();
$bus = $stmt->get_result()->fetch_assoc();
$stmt->close();
$conn->close();

if (!$bus) {
    header('Location: student_dashboard.php');
    exit;
}

$busName  = htmlspecialchars($bus['bus_name']);
$route    = htmlspecialchars($bus['route']);
$initLat  = (float)($bus['latitude']  ?? 14.5995);
$initLng  = (float)($bus['longitude'] ?? 120.9842);
$isActive = (int)($bus['is_active'] ?? 0);
$busNum   = (int)($bus['bus_id'] ?? 1);

// Format last updated
$lastUpdated = $bus['last_updated']
  ? date('M j, g:i:s A', strtotime($bus['last_updated']))
  : 'Never';
?><!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title><?php echo $busName; ?> — Live Tracking · BusTrack</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --white:         #ffffff;
      --off:           #f8f7f4;
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
      --shadow-sm:     0 1px 3px rgba(26,23,20,.06), 0 1px 2px rgba(26,23,20,.04);
      --shadow-md:     0 4px 16px rgba(26,23,20,.08), 0 2px 6px rgba(26,23,20,.04);
      --font:          'Geist', sans-serif;
      --serif:         'Instrument Serif', serif;
      --mono:          'Geist Mono', monospace;
    }

    @keyframes pulse  { 0%,100%{opacity:1} 50%{opacity:.35} }
    @keyframes fadeUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
    @keyframes spin   { to{transform:rotate(360deg)} }

    html, body { width: 100%; height: 100%; overflow: hidden; }
    body { font-family: var(--font); }

    /* ── Full-screen map ── */
    #map {
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      z-index: 1;
    }

    /* ── Floating top bar ── */
    .top-bar {
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 100;
      background: rgba(255,255,255,0.92);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      border: 1px solid rgba(228,223,213,.7);
      border-radius: 100px;
      padding: 8px 22px;
      display: flex;
      align-items: center;
      gap: 12px;
      pointer-events: none;
      box-shadow: var(--shadow-md);
      white-space: nowrap;
      animation: fadeUp .35s ease both;
    }
    .top-logo-icon {
      width: 24px; height: 24px;
      background: var(--accent);
      border-radius: 7px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .top-logo-icon svg { width: 14px; height: 14px; }
    .top-sep {
      width: 1px; height: 16px;
      background: var(--border); flex-shrink: 0;
    }
    .top-bus-name {
      font-size: .85rem;
      font-weight: 600;
      color: var(--text);
      letter-spacing: -.01em;
    }

    /* ── Floating info panel ── */
    .info-panel {
      position: fixed;
      right: 16px;
      top: 80px;
      z-index: 100;
      width: 260px;
      background: rgba(255,255,255,0.92);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      border: 1px solid rgba(228,223,213,.7);
      border-radius: 16px;
      padding: 18px 20px;
      box-shadow: var(--shadow-md);
      animation: fadeUp .4s ease .1s both;
    }

    .panel-label {
      font-family: var(--mono);
      font-size: .65rem;
      letter-spacing: .10em;
      text-transform: uppercase;
      color: var(--text3);
      margin-bottom: 10px;
    }
    .panel-bus-name {
      font-weight: 700;
      font-size: 1.1rem;
      color: var(--text);
      margin-bottom: 3px;
    }
    .panel-route {
      font-size: .8rem;
      color: var(--text2);
      margin-bottom: 14px;
      line-height: 1.5;
    }

    .panel-divider {
      height: 1px; background: var(--border);
      margin-bottom: 12px;
    }

    .panel-status {
      display: flex; align-items: center; gap: 8px;
      margin-bottom: 12px;
    }
    .badge-live {
      display: inline-flex; align-items: center; gap: 5px;
      background: var(--success-light); border: 1px solid #a7f3d0;
      color: var(--success); border-radius: 100px; padding: 3px 10px;
      font-family: var(--mono); font-size: .65rem; font-weight: 600;
    }
    .badge-live::before {
      content: ''; width: 6px; height: 6px;
      background: var(--success); border-radius: 50%;
      animation: pulse 1.5s ease infinite;
    }
    .badge-offline {
      display: inline-flex; align-items: center; gap: 5px;
      background: var(--off); border: 1px solid var(--border2);
      color: var(--text3); border-radius: 100px; padding: 3px 10px;
      font-family: var(--mono); font-size: .65rem; font-weight: 500;
    }

    .panel-row {
      display: flex; justify-content: space-between;
      align-items: baseline; margin-bottom: 8px;
    }
    .panel-row-label {
      font-family: var(--mono);
      font-size: .65rem;
      letter-spacing: .08em;
      text-transform: uppercase;
      color: var(--text3);
    }
    .panel-row-val {
      font-family: var(--mono);
      font-size: .8rem;
      font-weight: 500;
      color: var(--accent);
      text-align: right;
    }

    .panel-updated {
      font-family: var(--mono);
      font-size: .68rem;
      color: var(--text3);
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid var(--border);
    }

    /* spinning loader inside panel */
    .spinner {
      display: inline-block;
      width: 10px; height: 10px;
      border: 1.5px solid var(--border2);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin .7s linear infinite;
    }

    /* ── Back button ── */
    .btn-back {
      position: fixed;
      bottom: 24px; left: 16px;
      z-index: 100;
      background: rgba(255,255,255,0.92);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      border: 1px solid rgba(228,223,213,.7);
      border-radius: 100px;
      padding: 9px 18px;
      font-family: var(--font);
      font-size: .82rem;
      font-weight: 600;
      color: var(--text);
      cursor: pointer;
      text-decoration: none;
      display: inline-flex; align-items: center; gap: 6px;
      box-shadow: var(--shadow-sm);
      transition: box-shadow .15s, transform .15s;
      animation: fadeUp .4s ease .2s both;
    }
    .btn-back:hover { box-shadow: var(--shadow-md); transform: translateY(-1px); }

    /* ── Custom bus pin (teardrop) ── */
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

<!-- Full-screen map -->
<div id="map"></div>

<!-- Floating top bar -->
<div class="top-bar">
  <div class="top-logo-icon">
    <svg viewBox="0 0 20 20" fill="none">
      <rect x="2" y="6" width="16" height="10" rx="3" fill="white"/>
      <circle cx="6" cy="16" r="2" fill="white"/>
      <circle cx="14" cy="16" r="2" fill="white"/>
      <rect x="5" y="3" width="10" height="5" rx="1.5" fill="rgba(255,255,255,0.55)"/>
    </svg>
  </div>
  <div class="top-sep"></div>
  <span class="top-bus-name"><?php echo $busName; ?></span>
</div>

<!-- Floating info panel -->
<div class="info-panel">
  <div class="panel-label">Bus Info</div>
  <div class="panel-bus-name"><?php echo $busName; ?></div>
  <div class="panel-divider"></div>

  <div class="panel-status">
    <div id="statusBadge" class="<?php echo $isActive ? 'badge-live' : 'badge-offline'; ?>">
      <?php echo $isActive ? 'Live' : 'Offline'; ?>
    </div>
  </div>

  <div class="panel-row">
    <span class="panel-row-label">Latitude</span>
    <span class="panel-row-val" id="panelLat"><?php echo number_format($initLat, 6); ?>°</span>
  </div>
  <div class="panel-row">
    <span class="panel-row-label">Longitude</span>
    <span class="panel-row-val" id="panelLng"><?php echo number_format($initLng, 6); ?>°</span>
  </div>

  <div class="panel-updated" id="panelUpdated">
    Updated: <?php echo $lastUpdated; ?>
  </div>
</div>

<!-- Back button -->
<a href="student_dashboard.php" class="btn-back">
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M8.5 11L4.5 7l4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
  All Buses
</a>

<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var busId    = <?php echo (int)$bus['bus_id']; ?>;
var initLat  = <?php echo $initLat; ?>;
var initLng  = <?php echo $initLng; ?>;

// ── Build custom teardrop pin icon ──
var busNum  = <?php echo $busNum; ?>;
var busLabel = 'B' + busNum;
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

// ── Init map ──
var map = L.map('map', { zoomControl: true, attributionControl: true })
           .setView([initLat, initLng], 16);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19
}).addTo(map);

// ── Single marker ──
var marker = L.marker([initLat, initLng], { icon: busIcon, zIndexOffset: 1000 })
              .addTo(map)
              .bindPopup('<?php echo addslashes($busName); ?>');

// ── Panel elements ──
var panelLat     = document.getElementById('panelLat');
var panelLng     = document.getElementById('panelLng');
var panelUpdated = document.getElementById('panelUpdated');
var statusBadge  = document.getElementById('statusBadge');

function updatePanel(bus) {
  panelLat.textContent     = parseFloat(bus.latitude).toFixed(6)  + '°';
  panelLng.textContent     = parseFloat(bus.longitude).toFixed(6) + '°';
  panelUpdated.textContent = 'Updated: ' + (bus.last_updated || '—');

  if (parseInt(bus.is_active)) {
    statusBadge.className   = 'badge-live';
    statusBadge.textContent = 'Live';
  } else {
    statusBadge.className   = 'badge-offline';
    statusBadge.textContent = 'Offline';
  }
}

// ── Poll every 3 seconds ──
setInterval(function() {
  fetch('get_bus.php?bus_id=' + busId)
    .then(function(res) { return res.json(); })
    .then(function(bus) {
      if (bus.error) return;
      marker.setLatLng([parseFloat(bus.latitude), parseFloat(bus.longitude)]);
      updatePanel(bus);
    })
    .catch(function() {});
}, 3000);
</script>

</body>
</html>
