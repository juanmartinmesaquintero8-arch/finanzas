// Utilidades del paso posterior al build: arman la lista de archivos que el
// service worker guarda para que la app abra sin internet.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SKIPPED = new Set(['sw.js', '.nojekyll']);

/** Dirección pública de un archivo del build, respetando el basePath. */
export function precacheUrl(relPath, basePath) {
  const rel = relPath.split(sep).join('/');
  if (rel === 'index.html') return `${basePath}/`;
  if (rel.endsWith('/index.html')) return `${basePath}/${rel.slice(0, -'index.html'.length)}`;
  return `${basePath}/${rel}`;
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Lista las direcciones a guardar y una versión que cambia sólo si cambia el contenido. */
export function collectPrecache(outDir, basePath) {
  const hash = createHash('sha1');
  const urls = [];
  for (const file of walk(outDir).sort()) {
    const rel = relative(outDir, file).split(sep).join('/');
    if (SKIPPED.has(rel) || rel.endsWith('.map')) continue;
    urls.push(precacheUrl(rel, basePath));
    hash.update(rel).update(readFileSync(file));
  }
  return { urls, version: hash.digest('hex').slice(0, 12) };
}

/** Rellena la plantilla del service worker. */
export function buildServiceWorkerSource(template, { basePath, version, urls }) {
  return template
    .replaceAll('__VERSION__', version)
    .replaceAll('__BASE__', basePath)
    .replace('__PRECACHE__', JSON.stringify(urls));
}

const CSP_META = /<meta http-equiv="Content-Security-Policy"[^>]*>/gi;
const INLINE_SCRIPT = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi;
const encodeAttr = (s) => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;');

/**
 * Escribe la política de seguridad (CSP) en una página ya compilada, como primer elemento del
 * <head> (después del charset), para que cubra todos los estilos y scripts que vienen detrás.
 *
 * Next deja scripts en línea en cada página (los datos para arrancar React). En vez de permitir
 * cualquier script en línea ('unsafe-inline'), se autoriza solo la huella (sha256) de los que trae
 * esa página: un script inyectado por un atacante tendría otra huella y el navegador lo bloquearía.
 * Un <meta> en un sitio estático no admite nonces, por eso se hace al compilar. Se escribe aquí y no
 * desde React porque, si React la pintara, al arrancar no reconocería la versión con huellas y
 * agregaría una segunda copia.
 */
export function injectContentSecurityPolicy(html, policy) {
  const page = html.replace(CSP_META, '');
  const hashes = new Set();
  for (const [, body] of page.matchAll(INLINE_SCRIPT)) {
    if (body.trim()) hashes.add(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
  }
  let hasScriptSrc = false;
  const finalPolicy = policy
    .split(';')
    .map((part) => {
      const [name, ...sources] = part.trim().split(/\s+/);
      if (name !== 'script-src') return part.trim();
      hasScriptSrc = true;
      return [name, ...new Set([...sources, ...hashes])].join(' ');
    })
    .join('; ');
  if (!hasScriptSrc) throw new Error('La política Content-Security-Policy no tiene script-src.');

  const meta = `<meta http-equiv="Content-Security-Policy" content="${encodeAttr(finalPolicy)}"/>`;
  const anchor = /<meta charSet="[^"]*"\s*\/?>/i.exec(page) ?? /<head(\s[^>]*)?>/i.exec(page);
  if (!anchor) throw new Error('La página no tiene <head>: no se puede escribir la CSP.');
  const at = anchor.index + anchor[0].length;
  return page.slice(0, at) + meta + page.slice(at);
}
