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
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/js/bootstrap.bundle.min.js',
  '/preloaded_routes/artistpoint.gpx',
  '/preloaded_routes/blackhawkhikingloop.gpx',
  '/preloaded_routes/christianityspireloop.gpx',
  '/preloaded_routes/coloradoriverloop.gpx',
  '/preloaded_routes/crescentglacierloop.gpx',
  '/preloaded_routes/devilsgardenloop.gpx',
  '/preloaded_routes/doughertyvalleyloop.gpx',
  '/preloaded_routes/doughtyfalls.gpx',
  '/preloaded_routes/gumbolimbo.gpx',
  '/preloaded_routes/ironhorse.gpx',
  '/preloaded_routes/laddercanyon.gpx',
  '/preloaded_routes/lafayetteloop.gpx',
  '/preloaded_routes/lastrampascorralcamp.gpx',
  '/preloaded_routes/livermoreloop.gpx',
  '/preloaded_routes/melakwalake.gpx',
  '/preloaded_routes/middleteton.gpx',
  '/preloaded_routes/mountdiabloloop.gpx',
  '/preloaded_routes/pleasantonridge.gpx',
  '/preloaded_routes/quandarypeak.gpx',
  '/preloaded_routes/rockcityloop.gpx',
  '/preloaded_routes/sentinelrock.gpx',
  '/preloaded_routes/tahoerimtrail.gpx',
  '/preloaded_routes/tassahararidge.gpx',
  '/preloaded_routes/wallpointsummitstaircaseloop.gpx',
  '/preloaded_routes/washingtoncommonwealthtrail.gpx',
  '/preloaded_routes/washingtoncommonwealthtrail.gpx'
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