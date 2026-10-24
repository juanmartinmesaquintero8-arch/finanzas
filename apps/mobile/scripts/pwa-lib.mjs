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
