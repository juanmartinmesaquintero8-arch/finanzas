import { defineConfig, devices } from '@playwright/test';

// Pruebas en un navegador real contra el sitio compilado, con la misma dirección que en
// GitHub Pages (/finanzas/). Las variables van en `webServer.env` para que funcione igual
// en Windows y en Linux (CI), sin sintaxis propia de cada consola.
const PORT = 4173;
const BASE_PATH = '/finanzas';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}${BASE_PATH}/`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Pixel 7'] } }],
  webServer: {
    // Compila el sitio estático (con su service worker) y luego lo sirve.
    command: 'pnpm build && node e2e/serve.mjs',
    url: `http://127.0.0.1:${PORT}${BASE_PATH}/`,
    env: { NEXT_PUBLIC_BASE_PATH: BASE_PATH, PORT: String(PORT) },
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: 'pipe',
  },
});
