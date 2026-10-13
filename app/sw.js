// Service worker: makes the app work fully offline after the first visit.
//
// - Pre-caches every file of the app (list below) into a versioned cache.
// - Serves same-origin GET requests cache-first; anything not pre-cached
//   (e.g. the sample files) is cached the first time it is fetched.
// - Never touches requests to other origins (the app makes none — see the
//   Content-Security-Policy in index.html).
//
// VERSION is replaced with the git commit by the deploy workflow, so every
// deploy installs a fresh cache; the app then offers "Reload" to update.
// tests/precache.spec.js fails if a file in app/ is missing from PRECACHE.

const VERSION = '__BUILD__';
const CACHE = `attendance-pic-${VERSION}`;

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './css/bus.css',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon.svg',
  './icons/maskable-512.png',
  './js/main.js',
  './js/store.js',
  './vendor/LICENSES.md',
  './vendor/jspdf.plugin.autotable.min.js',
  './vendor/jspdf.umd.min.js',
  './vendor/xlsx.bundle.js',
  './js/domain/capacity.js',
  './js/domain/layout.js',
  './js/domain/model.js',
  './js/io/export.js',
  './js/io/importer.js',
  './js/io/parse.js',
  './js/io/pdf.js',
  './js/io/share.js',
  './js/io/vendor.js',
  './js/repo/errors.js',
  './js/repo/indexeddb.js',
  './js/repo/repository.js',
  './js/ui/admin.js',
  './js/ui/attendance-view.js',
  './js/ui/backup.js',
  './js/ui/bus-svg.js',
  './js/ui/dialogs.js',
  './js/ui/dom.js',
  './js/ui/event-view.js',
  './js/ui/export-flow.js',
  './js/ui/hero.js',
  './js/ui/icons.js',
  './js/ui/import-flow.js',
  './js/ui/layout-editor.js',
  './js/ui/reset-dialog.js',
  './js/ui/seat-interactions.js',
  './js/ui/seating-view.js',
  './js/utils/crypto.js',
  './js/utils/format.js',
  './js/utils/ids.js',
  './js/utils/mask.js',
  // Demo data for "Try sample data" (fake people; copied next to the app on deploy).
  './samples/participants_sample.xlsx',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('attendance-pic-') && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    // App shell: always answer navigations with the cached index.html.
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const cached = (await cache.match('./index.html')) || (await cache.match('./'));
        if (cached) return cached;
        return fetch(req);
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req, { ignoreSearch: true });
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    })(),
  );
});
