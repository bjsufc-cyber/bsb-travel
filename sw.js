// Offline shell. Online: always fetch the latest file (a cheap "has it changed?" request) so
// updates show on the next open. Offline or slow: fall back to the saved copy.
const CACHE = 'bsb-v20';
const FILES = ['./', 'index.html', 'styles.css', 'app.js', 'store.js', 'crypto.js', 'phrases.js', 'docs.js', 'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs', 'manifest.webmanifest', 'icons/logo-180.png', 'icons/logo-192.png', 'icons/logo-512.png', 'icons/flag-waves.svg'];
// Thai audio clips (audio/list.json names them) are saved too, so phrases play offline.
const save = (c, f) => fetch(f, { cache: 'reload' }).then((r) => r.ok && c.put(f, r));
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => Promise.all([
  ...FILES.map((f) => save(c, f)),
  fetch('audio/list.json', { cache: 'reload' }).then(async (r) => { if (!r.ok) return; await c.put('audio/list.json', r.clone()); await Promise.all(Object.values(await r.json()).map((f) => save(c, 'audio/' + f).catch(() => {}))); }).catch(() => {}),
])).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.search) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(e.request, { ignoreSearch: true });
    if (hit && url.pathname.endsWith('.m4a')) return hit; // clip names change when the audio does
    const net = fetch(e.request.url, { cache: 'no-cache' }).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; });
    if (!hit) return net;
    const slow = new Promise((res) => setTimeout(() => res(hit), 2500));
    return Promise.race([net.catch(() => hit), slow]);
  })());
});
