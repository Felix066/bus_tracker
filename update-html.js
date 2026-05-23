const fs = require('fs');
const path = require('path');

const files = [
  'index.html',
  'driver-login.html',
  'student-dashboard.html',
  'bus_track.html',
  'driver-dashboard.html'
];

const headTags = `
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#1A1A1A">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="apple-mobile-web-app-title" content="BusTrack">
`;

const bodyTop = `
<div id="offline-indicator" style="display:none; position:fixed; bottom:20px; left:50%; transform:translateX(-50%); background:#1A1A1A; color:white; padding:10px 20px; border-radius:20px; font-size:13px; font-weight:500; font-family:Inter,sans-serif; z-index:9999; box-shadow:0 4px 20px rgba(0,0,0,0.3); align-items:center; gap:8px;">
  You are offline - showing cached data
</div>
`;

const bodyBottom = `
<script>
window.addEventListener('online', () => {
  document.getElementById('offline-indicator').style.display = 'none';
  console.log('[Network] Back online');
});

window.addEventListener('offline', () => {
  document.getElementById('offline-indicator').style.display = 'flex';
  console.log('[Network] Gone offline');
});

if (!navigator.onLine) {
  document.getElementById('offline-indicator').style.display = 'flex';
}
</script>

<script>
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => {
        console.log('[BusTrack] Service Worker registered:', reg.scope);
      })
      .catch((err) => {
        console.warn('[BusTrack] Service Worker failed:', err);
      });
  });
}
</script>
`;

files.forEach(file => {
  const filePath = path.join(__dirname, file);
  if (!fs.existsSync(filePath)) {
    console.log('Skipping', file);
    return;
  }
  let content = fs.readFileSync(filePath, 'utf8');

  // Insert head tags before </head>
  if (!content.includes('<link rel="manifest"')) {
    content = content.replace('</head>', headTags + '</head>');
  }

  // Insert body top after <body>
  if (!content.includes('offline-indicator')) {
    content = content.replace(/<body>/i, '<body>' + bodyTop);
  }

  // Insert body bottom before </body>
  if (!content.includes('serviceWorker')) {
    content = content.replace(/<\/body>/i, bodyBottom + '</body>');
  }

  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Updated', file);
});
