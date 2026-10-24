// Arranca la API (puerto 3001) y la web (puerto 3000) juntas.
// Requiere que la base de datos ya esté encendida (`pnpm db:start` en otra terminal).
// Uso: pnpm dev   — Ctrl+C para detener todo.
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';

const DB_PORT = Number(process.env.PG_PORT ?? 54329);

function dbIsUp() {
  return new Promise((resolve) => {
    const socket = net.connect(DB_PORT, '127.0.0.1');
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('error', () => resolve(false));
  });
}

function step(title, args) {
  console.log(`\n> ${title}`);
  const result = spawnSync('pnpm', args, { stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    console.error(`\nNo se pudo completar: ${title}`);
    process.exit(result.status ?? 1);
  }
}

if (!(await dbIsUp())) {
  console.error('\nLa base de datos no está encendida.');
  console.error('Abre OTRA terminal en esta carpeta y ejecuta:  pnpm db:start');
  console.error('Déjala abierta y vuelve a ejecutar:  pnpm dev\n');
  process.exit(1);
}

step('Preparando el núcleo de la aplicación', ['--filter', '@finanzas/domain', 'build']);
step('Preparando la base de datos', ['--filter', '@finanzas/api', 'prisma:generate']);
step('Aplicando estructura de la base de datos', ['--filter', '@finanzas/api', 'prisma:deploy']);

const children = [
  spawn('pnpm', ['dev:api'], { stdio: 'inherit', shell: true }),
  spawn('pnpm', ['dev:web'], { stdio: 'inherit', shell: true }),
];

console.log('\nCuando veas "Ready", abre http://localhost:3000 en tu navegador.\n');

const stop = () => {
  for (const child of children) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill();
  }
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children) child.on('exit', (code) => code && stop());
