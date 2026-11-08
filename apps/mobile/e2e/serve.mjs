// Servidor estático mínimo para las pruebas en navegador: sirve `out/` bajo el basePath,
// igual que GitHub Pages (/finanzas/...). Solo usa Node, sin dependencias.
// Uso: node e2e/serve.mjs  (variables: PORT, por defecto 4173; NEXT_PUBLIC_BASE_PATH).
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../out', import.meta.url)));
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');
const port = Number(process.env.PORT ?? 4173);
const host = '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

if (!existsSync(join(root, 'index.html'))) {
  console.error('No existe out/index.html: compila primero (pnpm build).');
  process.exit(1);
}

/** Traduce la dirección pedida a un archivo dentro de out/, o null si no corresponde. */
function resolveFile(pathname) {
  if (basePath) {
    if (pathname !== basePath && !pathname.startsWith(`${basePath}/`)) return null;
    pathname = pathname.slice(basePath.length) || '/';
  }
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const file = normalize(join(root, decoded.endsWith('/') ? `${decoded}index.html` : decoded));
  // Nunca salir de out/ (protección contra "../").
  if (file !== root && !file.startsWith(root + sep)) return null;
  if (existsSync(file) && statSync(file).isFile()) return file;
  const asFolder = join(file, 'index.html');
  if (existsSync(asFolder)) return asFolder;
  return null;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${host}`);
  if (basePath && url.pathname === basePath) {
    res.writeHead(301, { Location: `${basePath}/` }).end();
    return;
  }
  const file = resolveFile(url.pathname);
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No encontrado');
    return;
  }
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  createReadStream(file).pipe(res);
});

server.listen(port, host, () => {
  console.log(`Sirviendo ${root} en http://${host}:${port}${basePath}/`);
});

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
