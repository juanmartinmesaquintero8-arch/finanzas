import { expect, test, type Page } from '@playwright/test';

/**
 * Actualización real v1 -> v2 en un navegador de verdad. Se siembra la base con el esquema v1 LITERAL
 * (el del celular del dueño) usando `indexedDB` crudo, antes de que exista la app en esa página.
 */
const NOTICE = 'Cierra las otras ventanas de Mis Finanzas para terminar de actualizar la app. Tus datos están a salvo.';
const SEED_PAGE = 'icons/icon-192.png'; // mismo origen, sin la app ni service worker

interface SeedOptions {
  /** Deja la conexión abierta, sin escuchar `versionchange` (una pestaña vieja que no se cierra sola). */
  keepOpen?: boolean;
  /** Agrega ya un almacén de la v2, para que la actualización falle y se aborte. */
  withCreditCards?: boolean;
}

async function seedV1(page: Page, options: SeedOptions = {}): Promise<void> {
  await page.evaluate(
    ({ keepOpen, withCreditCards }) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('mis-finanzas', 1);
        req.onerror = () => reject(req.error);
        req.onupgradeneeded = () => {
          const db = req.result;
          db.createObjectStore('accounts', { keyPath: 'id' });
          const tx = db.createObjectStore('transactions', { keyPath: 'id' });
          tx.createIndex('by-date', 'date');
          tx.createIndex('by-account-date', 'accountDates', { multiEntry: true });
          db.createObjectStore('scheduledExpenses', { keyPath: 'id' }).createIndex('by-account', 'accountId');
          db.createObjectStore('meta', { keyPath: 'key' });
          if (withCreditCards) db.createObjectStore('creditCards', { keyPath: 'id' });
        };
        req.onsuccess = () => {
          const db = req.result;
          const t = db.transaction(['accounts', 'transactions', 'scheduledExpenses', 'meta'], 'readwrite');
          t.objectStore('accounts').put({ id: 'a1', name: 'Bancolombia', type: 'BANK', initialBalance: '1500000', currency: 'COP' });
          t.objectStore('accounts').put({ id: 'a2', name: 'Efectivo', type: 'CASH', initialBalance: '20000', currency: 'COP' });
          t.objectStore('transactions').put({
            id: 't1', type: 'EXPENSE', amount: '35000', currency: 'COP', date: '2026-03-01T12:00:00.000Z',
            description: 'Mercado', category: 'Mercado', accountId: 'a1', fromAccountId: null, toAccountId: null,
            accountDates: ['a1|2026-03-01T12:00:00.000Z'],
          });
          t.objectStore('transactions').put({
            id: 't2', type: 'TRANSFER', amount: '5000', currency: 'COP', date: '2026-03-02T12:00:00.000Z',
            description: 'Retiro', category: null, accountId: null, fromAccountId: 'a1', toAccountId: 'a2',
            accountDates: ['a1|2026-03-02T12:00:00.000Z', 'a2|2026-03-02T12:00:00.000Z'],
          });
          t.objectStore('scheduledExpenses').put({
            id: 's1', description: 'Arriendo', amount: '900000', currency: 'COP', accountId: 'a1',
            frequency: 'MONTHLY', startDate: '2026-04-05', endDate: null, settledThrough: null,
          });
          t.objectStore('meta').put({ key: 'lastBackupAt', value: '2026-03-01T00:00:00.000Z' });
          t.oncomplete = () => {
            if (!keepOpen) db.close();
            resolve();
          };
          t.onerror = () => reject(t.error);
        };
      }),
    { keepOpen: options.keepOpen ?? false, withCreditCards: options.withCreditCards ?? false },
  );
}

/** Abre la base sin pedir versión y resume lo que hay, para comprobar que nada se perdió. */
async function inspect(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ version: number; stores: string[]; counts: Record<string, number>; indexes: Record<string, string[]> }>(
        (resolve, reject) => {
          const req = indexedDB.open('mis-finanzas');
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const db = req.result;
            const stores = [...db.objectStoreNames].sort();
            const t = db.transaction(stores, 'readonly');
            const counts: Record<string, number> = {};
            const indexes: Record<string, string[]> = {};
            for (const s of stores) {
              indexes[s] = [...t.objectStore(s).indexNames].sort();
              const c = t.objectStore(s).count();
              c.onsuccess = () => (counts[s] = c.result);
            }
            t.oncomplete = () => {
              db.close();
              resolve({ version: db.version, stores, counts, indexes });
            };
            t.onerror = () => reject(t.error);
          };
        },
      ),
  );
}

const ALL_V2 = ['accounts', 'cardPurchases', 'creditCards', 'meta', 'scheduledExpenses', 'scheduledIncomes', 'transactions'];

async function expectIntact(page: Page): Promise<void> {
  const info = await inspect(page);
  expect(info.version).toBe(2);
  expect(info.stores).toEqual(ALL_V2);
  expect(info.counts).toMatchObject({ accounts: 2, transactions: 2, scheduledExpenses: 1, meta: 1, scheduledIncomes: 0, creditCards: 0, cardPurchases: 0 });
  expect(info.indexes['transactions']).toEqual(['by-account-date', 'by-date']);
  expect(info.indexes['scheduledExpenses']).toEqual(['by-account']);
  expect(info.indexes['scheduledIncomes']).toEqual(['by-account']);
  expect(info.indexes['cardPurchases']).toEqual(['by-card']);
}

// Con datos, la pantalla principal es «Inicio» (el saludo «Mis Finanzas» es del estado vacío).
const heading = (page: Page) => page.getByRole('heading', { level: 1, name: 'Inicio' });

test('una base v1 real se actualiza a v2 sin perder datos y sin errores', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto(SEED_PAGE);
  await seedV1(page);
  await page.goto('./');
  await expect(heading(page)).toBeVisible();
  await expect(page.getByText('Bancolombia').first()).toBeVisible();
  await expectIntact(page);

  await page.reload();
  await expect(heading(page)).toBeVisible();
  await expect(page.getByText('Bancolombia').first()).toBeVisible();
  await expectIntact(page);
  expect(errors).toEqual([]);
  await context.close();
});

test('con otra ventana vieja abierta avisa que la cierres y luego abre con los datos', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL });
  const oldPage = await context.newPage();
  await oldPage.goto(SEED_PAGE);
  await seedV1(oldPage, { keepOpen: true });

  const appPage = await context.newPage();
  await appPage.goto('./');
  await expect(appPage.getByText(NOTICE)).toBeVisible();
  await expect(appPage.getByText('Bancolombia')).toHaveCount(0);

  await oldPage.close();
  await expect(heading(appPage)).toBeVisible();
  await expect(appPage.getByText('Bancolombia').first()).toBeVisible();
  await expect(appPage.getByText(NOTICE)).toHaveCount(0);
  await expectIntact(appPage);
  await context.close();
});

test('si la actualización falla, la app avisa y la base sigue en v1 con sus datos', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.goto(SEED_PAGE);
  await seedV1(page, { withCreditCards: true });

  await page.goto('./');
  await expect(page.getByText(/No pudimos abrir el almacenamiento de tu celular/)).toBeVisible();
  await expect(page.getByText(/la app no tocó tus datos/)).toBeVisible();

  const info = await inspect(page);
  expect(info.version).toBe(1);
  expect(info.counts).toMatchObject({ accounts: 2, transactions: 2, scheduledExpenses: 1, meta: 1 });
  await context.close();
});
