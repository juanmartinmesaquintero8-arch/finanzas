// Se ejecuta después de `next build`: crea el service worker con la lista real de archivos.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildServiceWorkerSource, collectPrecache } from './pwa-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'out');
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');

if (!existsSync(join(outDir, 'index.html'))) {
  console.error('No se encontró out/index.html: corre primero `next build`.');
  process.exit(1);
}

// GitHub Pages: sin esto ignora las carpetas que empiezan con "_" (como _next).
writeFileSync(join(outDir, '.nojekyll'), '');

const { urls, version } = collectPrecache(outDir, basePath);
const template = readFileSync(join(root, 'scripts', 'sw.template.js'), 'utf8');
writeFileSync(join(outDir, 'sw.js'), buildServiceWorkerSource(template, { basePath, version, urls }));
console.log(`sw.js listo: versión ${version}, ${urls.length} archivos guardados para usar sin internet (basePath "${basePath}").`);
