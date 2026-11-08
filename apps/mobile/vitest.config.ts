import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': src('./src'),
      // El dominio se prueba contra su código fuente: no hace falta compilarlo antes.
      '@finanzas/domain': src('../../packages/domain/src/index.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // e2e/ son pruebas de Playwright en navegador real: se corren con `pnpm e2e`, no con Vitest.
    exclude: [...configDefaults.exclude, 'e2e/**'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
  },
});
