import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:54329/finanzas_test?schema=public';

/** Aplica las migraciones sobre la BD de pruebas antes de la suite de integración. */
export default async function globalSetup(): Promise<void> {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  execSync('pnpm exec prisma migrate deploy', {
    cwd: resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'inherit',
  });
}
