// Levanta un PostgreSQL embebido para desarrollo (sin Docker ni permisos de administrador).
// Uso: pnpm db:start   — Ctrl+C para detenerlo.
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = Number(process.env.PG_PORT ?? 54329);
const DATABASES = ['finanzas', 'finanzas_test'];
const dataDir = resolve(import.meta.dirname, '..', '.pgdata');
const firstRun = !existsSync(dataDir);

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'postgres',
  port: PORT,
  persistent: true,
  onLog: () => {},
});

if (firstRun) await pg.initialise();
await pg.start();

for (const name of DATABASES) {
  try {
    await pg.createDatabase(name);
  } catch {
    // ya existe
  }
}

console.log(`PostgreSQL listo en postgresql://postgres:postgres@localhost:${PORT} (${DATABASES.join(', ')})`);

const shutdown = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
setInterval(() => {}, 1 << 30);
