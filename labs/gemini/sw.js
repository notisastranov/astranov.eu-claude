// AstranoV · Gemini's Lab — minimal service worker scoped to /gemini/.
// Network-first; falls back to the cached lab shell when offline.
'use strict';
const CACHE = 'astranov-gemini-v1';
self.addEventListener('install', e => { e.waitUntil((async () => {
  try { const c = await caches.open(CACHE); await c.addAll(['./','./index.html','./manifest.json']); } catch (_) {}
  self.skipWaiting();
})()); });
self.addEventListener('activate', e => { e.waitUntil(Promise.all([
  clients.claim(),
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))),
])); });
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.mode !== 'navigate') return;
  e.respondWith((async () => {
    try { const fresh = await fetch(req, { cache: 'no-store' }); const c = await caches.open(CACHE); c.put('./', fresh.clone()); return fresh; }
    catch (_) { return (await caches.match('./')) || new Response('Offline', { status: 503 }); }
  })());
});
