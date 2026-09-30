// Service worker : l'interface reste disponible sur réseau faible. L'API n'est jamais mise en cache.
const CACHE = 'bokkyoon-v3';
const SHELL = ['/', '/app/', '/chauffeur/', '/assets/styles.css', '/assets/ui.js', '/assets/client.js', '/assets/driver.js', '/assets/map.js', '/assets/api.js', '/assets/core.js', '/assets/icon.svg', '/assets/vendor/leaflet/leaflet.js', '/assets/vendor/leaflet/leaflet.css', '/manifest.webmanifest', '/imprimer/', '/assets/print.js', '/assets/invoice.js', '/assets/vendor/qrcode.js', '/assets/geo/regions.json'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; }).catch(() => caches.match(e.request)));
});
