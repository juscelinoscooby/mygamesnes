const CACHE_NAME = 'snes-boy-v10-cache';

// games.json = biblioteca: deixado fora do precache — sempre rede primeiro (ver fetch abaixo).
// Motivo: usuário organiza roms em pastas A-Z e cache velho congela visor em "2 PASTAS".
const ASSETS_TO_CACHE = [
  './index.html',
  './manifest.webmanifest',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './pix-qr.jpeg',
  './emulator/loader.js',
  './emulator/emulator.min.js',
  './emulator/emulator.min.css',
  './emulator/localization/pt-BR.json',
  './emulator/cores/reports/snes.json',
  './emulator/cores/reports/snes9x.json',
  './emulator/cores/snes9x-wasm.data',
  './emulator/cores/snes9x-legacy-wasm.data',
  './emulator/compression/extract7z.js',
  './emulator/compression/extractzip.js',
  './emulator/compression/libunrar.js',
  './emulator/compression/libunrar.wasm'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
        console.warn('Alguns assets não puderam ser pré-cacheados imediatamente:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // ROMs (.smc/.sfc) ficam no IndexedDB — não cachear no SW (evita duplicar MB e estourar quota)
  if (/\.(smc|sfc|fig|bs|rom)(\?|#|$)/i.test(req.url)) return;

  // games.json = biblioteca viva — rede primeiro, cache só se falhar (offline)
  const isGamesJson = req.url.includes('/games/games.json');
  if (isGamesJson) {
    event.respondWith(
      fetch(req).then((fresh) => {
        if (fresh && fresh.ok) {
          const clone = fresh.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone).catch(() => {}));
        }
        return fresh;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Demais assets: cache-first
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((response) => {
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        const cloned = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(req, cloned).catch(() => {});
        });
        return response;
      }).catch(() => {
        return cached;
      });
    })
  );
});
