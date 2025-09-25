const CACHE_NAME = 'bikeapp-cache-v1';
const staticAssets = [
  '/',
  '/index.html',
  '/app.js',
  '/manifest.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/localforage@1.9.0/dist/localforage.min.js',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/js/bootstrap.bundle.min.js'
];
// Install event: triggered when the service worker is first installed.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
        cache.addAll(staticAssets).then
    })
  );
});

// Activate event: triggered when the service worker becomes active.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
        Promise.all(key.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
    })
  );
});

// Fetch event: intercepts network requests.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);


  // Dynamic caching for map tiles
  if (url.hostname.includes('tile.openstreetmap.org')) {
    event.respondWith(
      caches.open('osm-tiles').then(cache =>
        cache.match(event.request).then(resp => {
          return resp || fetch(event.request).then(networkResp => {
            cache.put(event.request, networkResp.clone());
            return networkResp;
          });
        })
      )
    );
    return;
  }


  event.respondWith(
    caches.match(event.request).then(resp => resp || fetch(event.request))
  );
});