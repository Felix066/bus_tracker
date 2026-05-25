self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          console.log('[SW] Nuking old cache:', cacheName);
          return caches.delete(cacheName);
        })
      );
    }).then(() => {
      return self.registration.unregister();
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Always fetch from network to bypass cache entirely
  e.respondWith(fetch(e.request));
});
