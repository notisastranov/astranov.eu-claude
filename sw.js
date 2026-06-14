// AstranovOS — Service Worker
// Handles: offline shell, push notifications, notification click routing
'use strict';

const SHELL_CACHE = 'astranov-shell-v98';
const TILE_CACHE  = 'astranov-tiles-v1';
const TILE_HOSTS = [
  'basemaps.cartocdn.com',           // CARTO dark/voyager/light
  'tile.openstreetmap.org',          // OSM raster
  'gibs.earthdata.nasa.gov',         // NASA BMNG + Black Marble
  'services.arcgisonline.com',       // Esri satellite
  'stamen-tiles.a.ssl.fastly.net',   // Stamen (legacy)
  'tile.thunderforest.com',          // optional
];
const TILE_RX = /\.(png|jpe?g|webp|avif)(\?|$)/i;

self.addEventListener('install', e => {
  // Precache the app shell + icons + critical vendored JS so a first
  // visit makes AstranoV installable and offline-instant. Self-hosting
  // supabase-js means a CDN outage cannot kill the brain.
  e.waitUntil((async () => {
    try {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll([
        '/', '/manifest.json',
        '/icon-192.png', '/icon-512.png', '/icon-180.png',
        '/vendor/supabase.min.js',
      ]);
    } catch (_) { /* network may be flaky; SW still installs */ }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    await Promise.all([
      clients.claim(),
      // Drop only the old SHELL caches; KEEP the tile cache between deploys.
      caches.keys().then(keys => Promise.all(
        keys.filter(k => k !== SHELL_CACHE && k !== TILE_CACHE).map(k => caches.delete(k))
      )),
    ]);
    // Tell every open tab to reload so they pick up the fresh HTML
    // immediately — fixes the "I deployed but the changes don't show
    // up" stuck-Service-Worker symptom.
    try {
      const wins = await self.clients.matchAll({ type: 'window' });
      wins.forEach(w => { try { w.postMessage({ type: 'sw-activated', version: SHELL_CACHE }); } catch (_) {} });
    } catch (_) {}
  })());
});

// Cache-first stale-while-revalidate for raster map tiles.
async function _tileFetch(req) {
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(req);
  if (hit) {
    // Refresh in the background so the cache stays warm.
    fetch(req).then(r => { if (r && r.ok) cache.put(req, r.clone()); }).catch(()=>{});
    return hit;
  }
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (e) {
    // Do NOT fabricate a 503 — Cesium caches that as a permanently dead
    // tile (the "foggy base showing through" bug). Re-throw so the browser
    // reports a normal network error and Cesium retries the tile later.
    throw e;
  }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = (() => { try { return new URL(req.url); } catch { return null; } })();
  if (!url) return;

  // Map tiles
  if (req.method === 'GET' && TILE_HOSTS.some(h => url.host.endsWith(h)) && TILE_RX.test(url.pathname)) {
    e.respondWith(_tileFetch(req));
    return;
  }

  // HTML navigations: network-first, cache as offline fallback
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        const cache = await caches.open(SHELL_CACHE);
        cache.put('/', fresh.clone());
        return fresh;
      } catch (_) {
        const cached = await caches.match('/');
        return cached || new Response('Offline', { status: 503 });
      }
    })());
  }
});

// Push notification — fires even when app is closed
self.addEventListener('push', e => {
  const d = e.data ? e.data.json() : {};
  const isCall = d.type === 'call';

  const opts = {
    body:             d.body || '',
    icon:             d.icon || '/icon-192.png',
    badge:            '/badge-96.png',
    tag:              d.tag  || d.type || 'astranov',
    data:             d,
    requireInteraction: isCall,
    silent:           false,
    vibrate:          isCall ? [400, 150, 400, 150, 800] : [200, 80, 200],
    timestamp:        Date.now(),
    actions: isCall
      ? [{ action: 'accept',  title: '◈ Accept' },
         { action: 'decline', title: '✕ Decline' }]
      : (d.actions || []),
  };

  e.waitUntil(self.registration.showNotification(d.title || 'Astranov', opts));
});

// Notification click — focus or open app with context in URL
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const d      = e.notification.data || {};
  const action = e.action;

  // Decline without opening app
  if (d.type === 'call' && action === 'decline') {
    e.waitUntil(
      clients.matchAll({ type: 'window' }).then(list => {
        list.forEach(c => c.postMessage({ type: 'call-decline-push', callId: d.callId }));
      })
    );
    return;
  }

  // Build params to pass context into the app
  const p = new URLSearchParams();
  if (d.type)       p.set('notif', d.type);
  if (d.callId)     p.set('callId',     d.callId);
  if (d.callerId)   p.set('callerId',   d.callerId);
  if (d.callerName) p.set('callerName', d.callerName);
  if (d.senderId)   p.set('senderId',   d.senderId);
  if (d.senderName) p.set('senderName', d.senderName);
  if (d.deliveryId) p.set('deliveryId', d.deliveryId);
  if (action === 'accept' || d.autoAccept) p.set('accept', '1');

  const target = '/?' + p.toString();

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (new URL(c.url).origin === self.location.origin) {
          // App already open — post message and focus
          c.postMessage({ type: 'notif-nav', params: Object.fromEntries(p) });
          return c.focus();
        }
      }
      return clients.openWindow(target);
    })
  );
});

// Handle pushsubscriptionchange (subscription expired/renewed by browser)
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil(
    self.registration.pushManager.subscribe(e.oldSubscription?.options)
      .then(sub => {
        // Post to main thread to re-save subscription
        return clients.matchAll({ type: 'window' }).then(list => {
          list.forEach(c => c.postMessage({ type: 'push-resubscribe', sub: sub.toJSON() }));
        });
      })
  );
});
