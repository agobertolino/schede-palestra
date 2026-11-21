// Service worker: cache-first (stale-while-revalidate).
// Risponde subito dalla cache (funziona offline) e aggiorna la cache in background,
// così le modifiche a schede.json o al codice arrivano alla riapertura successiva.
const CACHE = 'schede-palestra-v6';
const FILES = ['./', 'index.html', 'app.js', 'style.css', 'schede.json', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    const rete = fetch(req.url, { cache: 'no-cache' })
      .then((res) => { if (res.ok) cache.put(req, res.clone()); return res; })
      .catch(() => null);
    if (hit) { e.waitUntil(rete); return hit; }
    const res = await rete;
    if (res) return res;
    if (req.mode === 'navigate') return (await cache.match('./')) || Response.error();
    return Response.error();
  })());
});
