// Mata Malam offline support.
// The app is kept on the phone, so it opens with no signal at all:
//  - The page, app.js and styles.css: from the network when there is signal (so updates arrive),
//    from the phone when there is none (or the signal is too slow to answer within a few seconds).
//  - The map library (Leaflet): kept on the phone after the first visit.
//  - Map pictures (OpenStreetMap tiles): every tile the guard has seen is kept (the newest few
//    thousand), so the map of the patrol area still shows offline.
//  - The AI System (sign in, sync, photos) is never touched here: the app keeps its own queue.
// Bump CACHE_VERSION when this file's caching rules change; the app's own updates need no bump.
const CACHE_VERSION = 'v1';
const APP_CACHE = `mata-malam-app-${CACHE_VERSION}`;
const LIB_CACHE = `mata-malam-lib-${CACHE_VERSION}`;
const TILE_CACHE = `mata-malam-tiles-${CACHE_VERSION}`;
const MAX_TILES = 3000;
const NETWORK_WAIT_MS = 4000;

const APP_FILES = ['./', 'index.html', 'app.js', 'styles.css', 'icon.svg', 'icon-180.png', 'manifest.json'];
const LIB_FILES = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const app = await caches.open(APP_CACHE);
    await Promise.all(APP_FILES.map(url => app.add(new Request(url, { cache: 'reload' })).catch(() => {})));
    const lib = await caches.open(LIB_CACHE);
    await Promise.all(LIB_FILES.map(url => lib.add(new Request(url, { mode: 'cors' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = [APP_CACHE, LIB_CACHE, TILE_CACHE];
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('mata-malam-') && !keep.includes(name)).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    // The version check must always ask the network (offline it simply fails, and nothing updates)
    if (url.pathname.endsWith('/version.json')) return;
    if (url.pathname.endsWith('/sw.js')) return;
    event.respondWith(networkFirst(request));
    return;
  }
  if (url.hostname === 'unpkg.com') {
    event.respondWith(cacheFirst(request, LIB_CACHE));
    return;
  }
  if (url.hostname === 'tile.openstreetmap.org') {
    event.respondWith(tile(request));
  }
});

// Same-site files: the network if it answers in time, else the copy on the phone. The ?v= on the
// address only says which version was asked for; offline any kept version is better than nothing.
async function networkFirst(request) {
  const cache = await caches.open(APP_CACHE);
  const isPage = request.mode === 'navigate';
  const key = isPage ? 'index.html' : request;
  const fromNetwork = fetch(request).then(response => {
    if (response && response.ok) {
      cache.put(key, response.clone()).catch(() => {});
      // Also kept without the ?v=, so an offline open finds the newest one whatever it asks for
      const plain = new URL(request.url);
      if (!isPage && plain.search) { plain.search = ''; cache.put(plain.toString(), response.clone()).catch(() => {}); }
    }
    return response;
  });
  const timeout = new Promise(resolve => setTimeout(() => resolve(null), NETWORK_WAIT_MS));
  try {
    const quick = await Promise.race([fromNetwork.catch(() => null), timeout]);
    if (quick) return quick;
  } catch (err) {}
  const kept = (await cache.match(key)) || (await cache.match(request, { ignoreSearch: true }));
  if (kept) return kept;
  // Nothing kept yet: wait for the network after all
  return fromNetwork;
}

async function cacheFirst(request, name) {
  const cache = await caches.open(name);
  const kept = await cache.match(request, { ignoreVary: true });
  if (kept) return kept;
  const response = await fetch(request);
  if (response && (response.ok || response.type === 'opaque')) cache.put(request, response.clone()).catch(() => {});
  return response;
}

// Map tiles: the phone's copy first (fast, and works offline), refreshed in the background when online
let tilesSinceTrim = 0;
async function tile(request) {
  const cache = await caches.open(TILE_CACHE);
  const kept = await cache.match(request, { ignoreVary: true });
  const refresh = fetch(request).then(response => {
    if (response && response.ok) {
      cache.put(request, response.clone()).catch(() => {});
      if (++tilesSinceTrim >= 100) { tilesSinceTrim = 0; trimTiles(cache); }
    }
    return response;
  }).catch(() => null);
  if (kept) return kept;
  const response = await refresh;
  return response || new Response('', { status: 504, statusText: 'Offline' });
}

async function trimTiles(cache) {
  const keys = await cache.keys();
  const extra = keys.length - MAX_TILES;
  for (let i = 0; i < extra; i++) await cache.delete(keys[i]);
}
