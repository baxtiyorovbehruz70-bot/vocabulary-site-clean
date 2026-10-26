/* Service worker for Behruz Vocab Trainer
 * - Never touches /api/ (always live data).
 * - Network first for pages and files, so students always get the newest app.js.
 * - Falls back to the last saved copy only when the network is unavailable.
 */
var CACHE = 'bv-shell-v1';
var SHELL = ['/', '/app.css', '/app.js', '/readaloud.js', '/icon-192.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(SHELL); })
      .catch(function () {})
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== location.origin) return;     // fonts etc. go straight to the network
  if (url.pathname.indexOf('/api/') === 0) return; // never cache the API

  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      })
      .catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || (req.mode === 'navigate' ? caches.match('/') : Response.error());
        });
      })
  );
});
