/* AMINA service worker: installable app, faster repeat visits, a friendly page when offline.
 * Pages and the API always come from the network, so prices, stock and orders are never stale. */
const VERSION = 'v1';
const STATIC = `amina-static-${VERSION}`;
const IMAGES = `amina-images-${VERSION}`;
const OFFLINE = '/offline.html';
const LIMITS = { [STATIC]: 150, [IMAGES]: 200 };

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC).then((c) => c.addAll([OFFLINE, '/icons/icon-192.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('amina-') && !(k in LIMITS)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Keeps a cache from growing forever: the oldest entries go first. */
async function trim(name) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - LIMITS[name]))) await cache.delete(k);
}

async function cacheFirst(req, name) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && (res.type === 'basic' || res.type === 'cors')) {
    const cache = await caches.open(name);
    await cache.put(req, res.clone());
    trim(name);
  }
  return res;
}

const STATIC_FILE = /\.(?:js|css|woff2?|ttf|svg|png|jpe?g|webp|avif|ico)$/i;

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // pages: always fresh from the network; offline → the offline page
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE)));
    return;
  }
  // Google Fonts: the files never change
  if (url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(req, STATIC));
    return;
  }
  if (url.origin !== self.location.origin) return;
  // uploaded product photos are stored under a unique id and never change
  if (url.pathname.startsWith('/api/images/')) {
    event.respondWith(cacheFirst(req, IMAGES));
    return;
  }
  if (url.pathname.startsWith('/api/')) return;
  // app bundles (hashed names), icons, bundled images
  if (STATIC_FILE.test(url.pathname) && url.pathname !== '/sw.js') event.respondWith(cacheFirst(req, STATIC));
});
