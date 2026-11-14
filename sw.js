// Offline shell. Online: always fetch the latest file (a cheap "has it changed?" request) so
// updates show on the next open. Offline or slow: fall back to the saved copy.
const CACHE = 'bsb-v5';
const FILES = ['./', 'index.html', 'styles.css', 'app.js', 'store.js', 'crypto.js', 'phrases.js', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', (e) => e.waitUntil(
  caches.open(CACHE).then((c) => Promise.all(FILES.map((f) => fetch(f, { cache: 'reload' }).then((r) => r.ok && c.put(f, r))))).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.search) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request.url, { cache: 'no-cache' }).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; });
    if (!hit) return net;
    const slow = new Promise((res) => setTimeout(() => res(hit), 2500));
    return Promise.race([net.catch(() => hit), slow]);
  })());
});
