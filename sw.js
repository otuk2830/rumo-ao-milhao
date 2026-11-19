// Offline support + fast start: the app opens from the copy saved on the phone, and checks GitHub
// for a newer version in the background (it is used the next time the app opens).
// Price lookups (other websites) always go straight to the network and are never cached.
const CACHE = 'rumo-v8.4';
const FILES = ['./', 'index.html', 'app.css', 'app.js', 'chart.umd.js', 'manifest.webmanifest',
  'icon-rumo-180.png', 'icon-rumo-192.png', 'icon-rumo-512.png', 'xlsx.mini.min.js', 'num-300.woff2', 'num-400.woff2', 'num-500.woff2', 'num-600.woff2', 'num-700.woff2'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // prices: network only
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const cached = await c.match(e.request);
    const fresh = fetch(e.request, { cache: 'no-cache' }).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; });
    if (cached) { e.waitUntil(fresh.catch(() => {})); return cached; }        // instant, update quietly
    return fresh.catch(() => c.match('index.html'));                          // first time / new version: network
  }));
});
