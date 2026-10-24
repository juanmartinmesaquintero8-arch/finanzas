// Levanta un PostgreSQL embebido para desarrollo (sin Docker ni permisos de administrador).
// Uso: pnpm db:start   — Ctrl+C para detenerlo.
// Opción: pnpm db:start --reset-encoding  → borra y recrea en UTF8 las BD que no lo estén (¡pierde sus datos!).
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = Number(process.env.PG_PORT ?? 54329);
const DATABASES = ['finanzas', 'finanzas_test'];
const RESET_ENCODING = process.argv.includes('--reset-encoding');
const dataDir = resolve(import.meta.dirname, '..', '.pgdata');
const firstRun = !existsSync(dataDir);

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'postgres',
  port: PORT,
  persistent: true,
  // Windows usa WIN1252 por defecto: forzamos UTF8 para tildes y emojis.
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => {},
});

if (firstRun) await pg.initialise();
await pg.start();

const client = pg.getPgClient();
await client.connect();

for (const name of DATABASES) {
  const { rows } = await client.query(
    'SELECT pg_encoding_to_char(encoding) AS encoding FROM pg_database WHERE datname = $1',
    [name],
  );
  const encoding = rows[0]?.encoding;

  if (encoding && encoding !== 'UTF8') {
    if (!RESET_ENCODING) {
      console.warn(`⚠ La BD "${name}" usa ${encoding}, no UTF8. Ejecuta "pnpm db:start --reset-encoding" para recrearla (borra sus datos).`);
      continue;
    }
    await client.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    console.log(`BD "${name}" eliminada para recrearla en UTF8.`);
  } else if (encoding) {
    continue;
  }

  await client.query(`CREATE DATABASE "${name}" ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`);
}

await client.end();
console.log(`PostgreSQL listo en postgresql://postgres:postgres@localhost:${PORT} (${DATABASES.join(', ')})`);

const shutdown = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
setInterval(() => {}, 1 << 30);
