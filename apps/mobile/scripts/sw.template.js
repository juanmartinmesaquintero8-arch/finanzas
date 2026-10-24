/* Service worker de Mis Finanzas. Lo completa scripts/postbuild.mjs después del build.
 * - Guarda todo el sitio al instalarse (precache), así abre sin internet.
 * - Responde primero con lo guardado (cache-first); lo nuevo lo pide a la red y lo guarda.
 * - Cada versión de la app usa su propia caché y borra las anteriores.
 * Los datos del usuario NO pasan por aquí: viven en IndexedDB. */
const VERSION = '__VERSION__';
const BASE = '__BASE__';
const CACHE = 'finanzas-' + VERSION;
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('finanzas-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (BASE && url.pathname !== BASE && !url.pathname.startsWith(BASE + '/')) return;
  event.respondWith(respond(request, url));
});

/** Las páginas del sitio terminan en "/" (carpeta/index.html). */
function pageUrl(url) {
  const copy = new URL(url.href);
  if (!copy.pathname.endsWith('/') && !/\.[a-z0-9]+$/i.test(copy.pathname)) copy.pathname += '/';
  return copy;
}

async function respond(request, url) {
  const cache = await caches.open(CACHE);
  const isPage = request.mode === 'navigate';
  const target = isPage ? pageUrl(url).href : request;
  const hit = await cache.match(target, { ignoreSearch: true });
  if (hit) return hit;
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    if (isPage) {
      const home = await cache.match(BASE + '/', { ignoreSearch: true });
      if (home) return home;
    }
    throw error;
  }
}
