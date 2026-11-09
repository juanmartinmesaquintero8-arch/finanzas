import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

/** Lo que el navegador reporta como bloqueado por la política de seguridad (CSP). */
interface Violation {
  directive: string;
  blocked: string;
}

declare global {
  interface Window {
    __cspViolations: Violation[];
  }
}

/**
 * Escucha las violaciones de CSP desde antes de que cargue la página (y en cada recarga), y también
 * todo console.error: un error al arrancar React (por ejemplo por el <meta> que agrega el postbuild)
 * debe hacer fallar la prueba. `isAllowed` es la única excepción y cada caso debe justificarse.
 */
async function watchViolations(page: Page, isAllowed: (msg: ConsoleMessage) => boolean = () => false): Promise<string[]> {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !isAllowed(msg)) consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspViolations.push({ directive: e.effectiveDirective, blocked: e.blockedURI });
    });
  });
  return consoleErrors;
}

async function expectNoViolations(page: Page, consoleErrors: string[]): Promise<void> {
  // Los avisos llegan al pedir cada recurso: se espera a que terminen las descargas y las fuentes.
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
  expect(consoleErrors).toEqual([]);
}

const mainScreen = (page: Page) => page.getByRole('heading', { name: /mis finanzas/i });

test('la CSP está en el <head>, antes de scripts y estilos, y no bloquea nada bajo /finanzas/', async ({ page }) => {
  const consoleErrors = await watchViolations(page);
  await page.goto('./');

  const meta = page.locator('head meta[http-equiv="Content-Security-Policy"]');
  await expect(meta).toHaveCount(1);
  // La política solo protege lo que viene después de ella en el documento.
  const precedesResources = await page.evaluate(() => {
    const head = document.head;
    const csp = head.querySelector('meta[http-equiv="Content-Security-Policy"]');
    if (!csp) return false;
    const resources = head.querySelectorAll('script, style, link');
    return [...resources].every((el) => csp.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(precedesResources).toBe(true);
  // Los scripts en línea se autorizan por huella, nunca en bloque ni con eval.
  const scriptSrc = /script-src ([^;]*)/.exec((await meta.getAttribute('content')) ?? '')?.[1] ?? '';
  expect(scriptSrc).toMatch(/^'self'( 'sha256-[A-Za-z0-9+/=]+')+$/);

  await expect(page).toHaveTitle('Mis Finanzas');
  await expect(mainScreen(page)).toBeVisible();
  // La fuente Inter se sirve desde el propio sitio y debe cargar.
  expect(await page.evaluate(async () => (await document.fonts.ready, [...document.fonts].some((f) => f.status === 'loaded')))).toBe(true);
  await expectNoViolations(page, consoleErrors);
});

test('sin conexión, la app recargada vuelve a abrir la pantalla principal', async ({ page, context }) => {
  const consoleErrors = await watchViolations(page);
  await page.goto('./');
  await expect(mainScreen(page)).toBeVisible();

  // El service worker termina de instalarse (y de guardar el sitio) y toma el control de la página.
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toMatch(/\/finanzas\/$/);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  await context.setOffline(true);
  await page.reload();
  await expect(mainScreen(page)).toBeVisible();
  await expect(page).toHaveTitle('Mis Finanzas');
  await expectNoViolations(page, consoleErrors);
});

// Cada pantalla es su propia página HTML con sus propias huellas: se abren una por una, en frío.
const ROUTES = [
  'agregar/',
  'ajustes/',
  'historial/',
  // Las dos vistas nuevas del Historial: el gasto por categoría y el historial filtrado desde una fila.
  'historial/?vista=gasto',
  'historial/?vista=gasto&mes=2026-10',
  'historial/?mes=2026-10&categoria=mercado',
  'programados/',
  'cuentas/nueva/',
  'cuentas/editar/',
  'movimientos/editar/',
];

for (const route of ROUTES) {
  test(`/finanzas/${route} abre sin violaciones de CSP`, async ({ page }) => {
    const consoleErrors = await watchViolations(page);
    await page.goto(route);
    await expect(page.locator('head meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expectNoViolations(page, consoleErrors);
  });
}

test('sin conexión, "En qué gasto" vuelve a abrir y muestra el estado vacío', async ({ page, context }) => {
  const consoleErrors = await watchViolations(page);
  await page.goto('historial/?vista=gasto');
  await expect(page.getByRole('heading', { level: 2, name: /\d{4}$/ })).toBeVisible();
  await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('group', { name: 'Vista' })).toBeVisible();
  await expect(page.getByText(/Todavía no hay gastos en/)).toBeVisible();
  await expectNoViolations(page, consoleErrors);
});

test('una dirección que no existe muestra la página 404, sin violaciones de CSP', async ({ page, baseURL }) => {
  const missingUrl = new URL('esta-pagina-no-existe/', baseURL).href;
  // Permitido solo esto: Chromium siempre avisa en consola cuando el propio documento responde 404.
  const consoleErrors = await watchViolations(page, (msg) => msg.location().url === missingUrl && /status of 404/.test(msg.text()));
  const response = await page.goto(missingUrl);
  expect(response?.status()).toBe(404);
  await expect(page.locator('head meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1, name: '404' })).toBeVisible();
  await expectNoViolations(page, consoleErrors);
});
