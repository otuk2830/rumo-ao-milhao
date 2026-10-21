// Offline support: the app files are cached on the phone. Price lookups always go to the network.
const CACHE = 'rumo-v3.1';
const FILES = ['./', 'index.html', 'app.css', 'app.js', 'chart.umd.js', 'manifest.webmanifest',
  'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'xlsx.mini.min.js'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // prices: network only
  // network first (so updates arrive), fall back to cache when offline
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((r) => {
    const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
});
