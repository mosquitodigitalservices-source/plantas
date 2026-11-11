// Service worker: guarda la app en caché para que abra sin conexión. Los datos están en IndexedDB, no aquí.
// Sube VERSION cada vez que cambie cualquier archivo de la lista.
const VERSION = 'plantas-a9d9708';
const FILES = [
  './', 'index.html', 'manifest.webmanifest',
  'css/tokens.css', 'css/components.css', 'css/app.css',
  'icons/icons.svg', 'icons/app-180.png', 'icons/app-192.png', 'icons/app-512.png',
  'data/species.json', 'data/problems.json',
  'js/app.js', 'js/db.js', 'js/dates.js', 'js/care.js', 'js/calendar.js', 'js/photos.js', 'js/identify.js',
  'js/ui.js', 'js/backup.js', 'js/diagnose.js', 'js/light.js', 'js/session.js', 'js/sync.js', 'js/firebase-config.js', 'js/moved.js',
  'js/screens/parts.js', 'js/screens/home.js', 'js/screens/plants.js', 'js/screens/plant.js', 'js/screens/camera.js',
  'js/screens/result.js', 'js/screens/add.js', 'js/screens/settings.js', 'js/screens/stub.js', 'js/screens/species.js',
  'js/screens/task.js', 'js/screens/calendar.js', 'js/screens/diagnose.js', 'js/screens/light.js', 'js/screens/account.js',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' salta la caché HTTP (GitHub Pages la guarda 10 minutos): así cada versión trae sus archivos.
  event.waitUntil(caches.open(VERSION)
    .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Archivos de la app: primero la caché. Pl@ntNet y cualquier otro origen: siempre la red.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // SDK de Firebase (versión fija): se guarda la primera vez para que la app abra sin conexión.
  if (event.request.method === 'GET' && url.origin === 'https://www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    event.respondWith(caches.open(VERSION).then((c) => c.match(event.request).then((hit) => hit || fetch(event.request).then((res) => {
      if (res.ok) c.put(event.request, res.clone());
      return res;
    }))));
    return;
  }
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((hit) => hit || fetch(event.request).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(event.request, copy));
      }
      return res;
    }).catch(() => caches.match('index.html'))),
  );
});
