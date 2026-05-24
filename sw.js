const CACHE_NAME = 'bustrack-v4';
const STATIC_CACHE = 'bustrack-static-v4';
const TILE_CACHE  = 'bustrack-tiles-v4';
const MAX_TILES  = 500;

async function cacheTileWithLimit(cache, request, response) {
  const keys = await cache.keys();
  if (keys.length >= MAX_TILES) {
    const toDelete = keys.slice(0, 50);
    await Promise.all(toDelete.map(k => cache.delete(k)));
    console.log('[SW] Evicted 50 old tiles from cache');
  }
  await cache.put(request, response.clone());
}

const STATIC_FILES = [
  '/',
  '/index.html',
  '/driver-login.html',
  '/student-dashboard.html',
  '/driver-dashboard.html',
  '/css/global.css',
  '/css/login.css',
  '/css/dashboard.css',
  '/css/driver.css',
  '/js/supabase-client.js',
  '/js/auth.js',
  '/js/driver-auth.js',
  '/js/routes.js',
  '/js/haversine.js',
  '/js/kalman.js',
  '/js/map.js',
  '/js/gps.js',
  '/js/location.js',
  '/js/trip.js',
  '/js/timer.js',
  '/js/sync.js',
  '/js/dashboard.js',
  '/student-console.html',
  '/js/student-console.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      console.log('[SW] Caching static files');
      return cache.addAll(STATIC_FILES);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter(key => key !== STATIC_CACHE && key !== TILE_CACHE)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (
    url.hostname === 'a.tile.openstreetmap.org' ||
    url.hostname === 'b.tile.openstreetmap.org' ||
    url.hostname === 'c.tile.openstreetmap.org' ||
    url.hostname.endsWith('.tile.openstreetmap.org') ||
    url.hostname.endsWith('.basemaps.cartocdn.com')
  ) {
    event.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) {
          console.log('[SW] Tile from cache:', url.pathname);
          return cached;
        }
        try {
          const response = await fetch(event.request);
          if (response.ok && response.status === 200) {
            await cacheTileWithLimit(cache, event.request, response);
            console.log('[SW] Tile fetched and cached:', url.pathname);
            return response.clone();
          }
          return response;
        } catch (err) {
          console.warn('[SW] Tile fetch failed, no cache:', url.pathname);
          const emptyTile = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
          return new Response(
            Uint8Array.from(atob(emptyTile), c => c.charCodeAt(0)),
            { headers: { 'Content-Type': 'image/png' } }
          );
        }
      })
    );
    return;
  }

  if (url.hostname.includes('supabase.co')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(
          JSON.stringify({ error: 'Offline' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  if (url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const response = await fetch(event.request);
        cache.put(event.request, response.clone());
        return response;
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          caches.open(STATIC_CACHE).then((cache) => {
            cache.put(event.request, response.clone());
          });
        }
        return response;
      }).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
        return new Response('', { status: 408 });
      });
    })
  );
});
