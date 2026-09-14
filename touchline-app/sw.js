/* Touchline service worker.
   Shell is cached so the app opens offline.
   data.json is network-first so a fresh build lands as soon as you have signal. */
const VERSION = 'touchline-v1';
const SHELL = ['./', './index.html', './styles.css', './app.js',
               './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // never cache the FPL proxy — team lookups must be live
  if (url.pathname.includes('/api/fpl') || url.pathname.includes('/functions/fpl')) return;

  // player data: try the network, fall back to whatever we last stored
  if (url.pathname.endsWith('data.json')) {
    e.respondWith(
      fetch(req).then(r => {
        const copy = r.clone();
        caches.open(VERSION).then(c => c.put('./data.json', copy));
        return r;
      }).catch(() => caches.match('./data.json'))
    );
    return;
  }

  // everything else: cache first, refresh in the background
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(r => {
        if (r.ok && url.origin === location.origin) {
          const copy = r.clone();
          caches.open(VERSION).then(c => c.put(req, copy));
        }
        return r;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
