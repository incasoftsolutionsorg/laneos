// LaneOS lane service worker (blueprint SLICE-004, ADR-0005): lets a registered lane reload checkout without
// internet. Scope /lane/. Sales made offline still go to the IndexedDB queue; this only keeps the page itself.
//   * /_next/static/*        cache first (file names are content hashes)
//   * lane pages (checkout, PIN, display, print)  network first; the last good copy is used when offline
const PAGES = 'laneos-lane-pages-v1';
const STATIC = 'laneos-lane-static-v1';
const LANE_PAGE = /^\/lane\/([0-9a-f-]{36}(\/(pin|display))?|print|locked)\/?$/;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (![PAGES, STATIC].includes(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  // Sent by the lane when it signs out or the device is unregistered.
  if (event.data === 'laneos:clear') event.waitUntil(Promise.all([caches.delete(PAGES), caches.delete(STATIC)]));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  if (req.mode === 'navigate' && LANE_PAGE.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(PAGES);
      try {
        const res = await fetch(req);
        // Only a real page for this path is kept (not a redirect to sign-in or to the PIN screen).
        if (res.ok && !res.redirected) cache.put(url.pathname, res.clone());
        return res;
      } catch {
        const hit = await cache.match(url.pathname);
        if (hit) return hit;
        return new Response(
          '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Offline</title>' +
          '<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0">' +
          '<div style="max-width:420px;text-align:center;padding:24px"><h1 style="font-size:20px">No connection</h1>' +
          '<p style="opacity:.7">This lane has not been opened online on this device yet, so it cannot start offline. Connect once, open the lane, and it will work offline after that.</p>' +
          '<button onclick="location.reload()" style="padding:10px 18px;border-radius:8px;border:0">Try again</button></div>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })());
  }
});
