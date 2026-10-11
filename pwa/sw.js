// Service Worker: speichert alle Dateien des Spiels, damit es ohne Internet startet.
// Die Platzhalter für Version und Dateiliste füllt der Build (siehe vite.config.ts).
const PREFIX = 'stadtbauer-';
const CACHE = PREFIX + '__VERSION__';
const FILES = __FILES__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // 'reload' umgeht den Zwischenspeicher des Browsers. Sonst könnte eine alte index.html
      // neben den neuen Skripten landen, und die App bliebe nach einem Update leer.
      .then((cache) => cache.addAll(FILES.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

// Eine neue Version räumt die Zwischenspeicher der alten weg, aber nur die dieses Spiels:
// andere Seiten unter derselben Adresse (github.io) haben eigene.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith(PREFIX) && key !== CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => cached ?? fetch(request)),
  );
});
