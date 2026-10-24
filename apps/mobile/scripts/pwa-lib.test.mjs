// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildServiceWorkerSource, collectPrecache, precacheUrl } from './pwa-lib.mjs';

let dir;
const put = (rel, content = rel) => {
  const full = join(dir, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pwa-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('precacheUrl', () => {
  it('convierte archivos en direcciones respetando el basePath', () => {
    expect(precacheUrl('index.html', '/finanzas')).toBe('/finanzas/');
    expect(precacheUrl('historial/index.html', '/finanzas')).toBe('/finanzas/historial/');
    expect(precacheUrl('_next/static/chunks/a.js', '/finanzas')).toBe('/finanzas/_next/static/chunks/a.js');
    expect(precacheUrl('index.html', '')).toBe('/');
    expect(precacheUrl('manifest.webmanifest', '')).toBe('/manifest.webmanifest');
  });
});

describe('collectPrecache', () => {
  it('lista todo el sitio estático menos el propio sw.js y los mapas', () => {
    put('index.html');
    put('historial/index.html');
    put('historial/index.txt');
    put('manifest.webmanifest', '{}');
    put('icons/icon-192.png');
    put('_next/static/chunks/app.js');
    put('_next/static/chunks/app.js.map');
    put('sw.js');
    put('.nojekyll', '');
    const { urls } = collectPrecache(dir, '/finanzas');
    expect(urls).toEqual(
      expect.arrayContaining([
        '/finanzas/',
        '/finanzas/historial/',
        '/finanzas/historial/index.txt',
        '/finanzas/manifest.webmanifest',
        '/finanzas/icons/icon-192.png',
        '/finanzas/_next/static/chunks/app.js',
      ]),
    );
    expect(urls.some((u) => u.endsWith('sw.js'))).toBe(false);
    expect(urls.some((u) => u.endsWith('.map'))).toBe(false);
    expect(urls.some((u) => u.includes('.nojekyll'))).toBe(false);
  });

  it('la versión cambia cuando cambia el contenido y es estable si no', () => {
    put('index.html', 'uno');
    const a = collectPrecache(dir, '').version;
    expect(collectPrecache(dir, '').version).toBe(a);
    put('index.html', 'dos');
    expect(collectPrecache(dir, '').version).not.toBe(a);
  });
});

describe('buildServiceWorkerSource', () => {
  const template = readFileSync(new URL('./sw.template.js', import.meta.url), 'utf8');

  it('rellena versión, basePath y lista de archivos', () => {
    const src = buildServiceWorkerSource(template, { basePath: '/finanzas', version: 'abc123', urls: ['/finanzas/', '/finanzas/a.js'] });
    expect(src).toContain("const VERSION = 'abc123'");
    expect(src).toContain("const BASE = '/finanzas'");
    expect(src).toContain('"/finanzas/a.js"');
    expect(src).not.toContain('__VERSION__');
    expect(src).not.toContain('__PRECACHE__');
    expect(src).not.toContain('__BASE__');
  });

  describe('comportamiento del service worker', () => {
    function boot({ cached = {}, online = true } = {}) {
      const store = new Map(Object.entries(cached));
      const listeners = {};
      const cache = {
        addAll: vi.fn(async (urls) => urls.forEach((u) => store.set(u, new Response(`pre:${u}`)))),
        match: vi.fn(async (req) => {
          const url = new URL(typeof req === 'string' ? req : req.url, 'https://x.test');
          return store.get(url.pathname)?.clone();
        }),
        put: vi.fn(async (req, res) => store.set(new URL(req.url).pathname, res)),
      };
      const caches = { open: vi.fn(async () => cache), keys: vi.fn(async () => ['finanzas-viejo', 'otra-cosa']), delete: vi.fn(async () => true) };
      const fetchFn = vi.fn(async () => {
        if (!online) throw new TypeError('offline');
        return new Response('red');
      });
      const self = {
        location: { origin: 'https://x.test' },
        addEventListener: (name, fn) => (listeners[name] = fn),
        skipWaiting: vi.fn(),
        clients: { claim: vi.fn() },
      };
      const src = buildServiceWorkerSource(template, { basePath: '/finanzas', version: 'v2', urls: ['/finanzas/', '/finanzas/a.js'] });
      vm.runInNewContext(src, { self, caches, fetch: fetchFn, URL, Response, Promise, TypeError });
      const dispatch = async (name, extra = {}) => {
        let pending;
        listeners[name]({ waitUntil: (p) => (pending = p), respondWith: (p) => (pending = p), ...extra });
        return pending;
      };
      return { self, caches, cache, fetchFn, dispatch, store, listeners };
    }
    const request = (path, init = {}) => ({ url: `https://x.test${path}`, method: 'GET', mode: 'cors', ...init });

    it('al instalar guarda todo el sitio y toma el control enseguida', async () => {
      const sw = boot();
      await sw.dispatch('install');
      expect(sw.cache.addAll).toHaveBeenCalledWith(['/finanzas/', '/finanzas/a.js']);
      expect(sw.self.skipWaiting).toHaveBeenCalled();
    });

    it('al activar borra las cachés viejas de la app y sólo esas', async () => {
      const sw = boot();
      await sw.dispatch('activate');
      expect(sw.caches.delete).toHaveBeenCalledWith('finanzas-viejo');
      expect(sw.caches.delete).not.toHaveBeenCalledWith('otra-cosa');
      expect(sw.self.clients.claim).toHaveBeenCalled();
    });

    it('sirve primero lo guardado (cache-first), aunque la dirección traiga ?parámetros', async () => {
      const sw = boot({ cached: { '/finanzas/a.js': new Response('guardado') } });
      const res = await sw.dispatch('fetch', { request: request('/finanzas/a.js?v=1') });
      expect(await res.text()).toBe('guardado');
      expect(sw.fetchFn).not.toHaveBeenCalled();
    });

    it('lo que no está guardado lo pide a la red y lo guarda', async () => {
      const sw = boot();
      const res = await sw.dispatch('fetch', { request: request('/finanzas/nuevo.js') });
      expect(await res.text()).toBe('red');
      expect(sw.cache.put).toHaveBeenCalled();
    });

    it('sin internet, abrir la app (navegación) devuelve la página guardada', async () => {
      const sw = boot({ online: false, cached: { '/finanzas/ajustes/': new Response('ajustes'), '/finanzas/': new Response('inicio') } });
      const res = await sw.dispatch('fetch', { request: request('/finanzas/ajustes', { mode: 'navigate' }) });
      expect(await res.text()).toBe('ajustes'); // agrega la barra final que usa el sitio
      const home = await sw.dispatch('fetch', { request: request('/finanzas/desconocida/', { mode: 'navigate' }) });
      expect(await home.text()).toBe('inicio'); // último recurso: la pantalla de inicio
    });

    it('ignora lo que no es suyo: POST, otros sitios y rutas fuera del basePath', () => {
      const sw = boot();
      const respond = vi.fn();
      sw.listeners.fetch({ request: request('/finanzas/a.js', { method: 'POST' }), respondWith: respond });
      sw.listeners.fetch({ request: { url: 'https://otro.com/finanzas/a.js', method: 'GET', mode: 'cors' }, respondWith: respond });
      sw.listeners.fetch({ request: request('/otra-app/a.js'), respondWith: respond });
      expect(respond).not.toHaveBeenCalled();
    });
  });
});
