/* RentFlow service worker: keeps the app itself available without signal.
   - Pages: network first (so updates arrive), falling back to the last saved copy of the app.
   - /static files have hashed names, so a saved copy is always right: served from the saved copy first.
   - API calls go to another address and are not touched here (the app saves its own copies). */
const SHELL = 'rentflow-shell-v1';
const STATIC = 'rentflow-static-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== SHELL && k !== STATIC) await caches.delete(k);
  await self.clients.claim();
})()));

async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function navigate(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 6000))]);
    if (res && res.ok) { cache.put('/shell', res.clone()); return res; }
    if (res && res.status >= 500) throw new Error('server error');
    return res;
  } catch (err) {
    const saved = await cache.match('/shell');
    return saved || new Response('RentFlow is offline and has not been opened on this device before. Connect once, then it will work offline.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok) { cache.put(req, res.clone()); trim(cache, 80); }
  return res;
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(req);
  const net = fetch(req).then((res) => { if (res && res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || net;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') return e.respondWith(navigate(req));
  if (url.pathname.startsWith('/static/')) return e.respondWith(cacheFirst(req));
  if (/\.(png|jpe?g|svg|ico|json|webmanifest|woff2?)$/.test(url.pathname)) return e.respondWith(staleWhileRevalidate(req));
});
