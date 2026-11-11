import { expect, test, type Page } from '@playwright/test';

/**
 * Actualización real v2 -> v3 en un navegador de verdad. Se siembra la base con el esquema v2 LITERAL
 * (tarjetas, compras y pagos con el sistema de hoy) usando `indexedDB` crudo, antes de que exista la app.
 */
const SEED_PAGE = 'icons/icon-192.png'; // mismo origen, sin la app ni service worker

const ACCOUNT = { id: 'a1', name: 'Bancolombia', type: 'BANK', initialBalance: '1500000', currency: 'COP' };
const CARD = {
  id: 'c1', name: 'Visa', dueDay: 15, cutDay: 30, paymentAccountId: 'a1', feeKind: 'FIXED_MONTHLY', feeAmount: '18000', currency: 'COP',
  rateBasis: 'MV', ratePpm: 20000, feeStartMonth: '2026-01', feesSettledThrough: '2026-02',
};
const PURCHASE = {
  id: 'p1', cardId: 'c1', description: 'Nevera', category: 'Hogar', amount: '1200000', currency: 'COP', installments: 12,
  purchaseDate: '2026-01-10T00:00:00.000Z', firstDueDate: '2026-02-15T00:00:00.000Z', monthlyRatePpm: 20000, paidInstallments: 2, closedOn: null, dueDayAnchor: 15,
};
const PAYMENTS = [
  { id: 'cp-p1-2', type: 'EXPENSE', amount: '100000', currency: 'COP', date: '2026-03-15T00:00:00.000Z', description: 'Nevera (cuota 2/12)', category: 'Hogar', accountId: 'a1', fromAccountId: null, toAccountId: null, accountDates: ['a1|2026-03-15T00:00:00.000Z'] },
  { id: 'ci-p1-2', type: 'EXPENSE', amount: '22000', currency: 'COP', date: '2026-03-15T00:00:00.000Z', description: 'Intereses Nevera (cuota 2/12)', category: 'Intereses y manejo', accountId: 'a1', fromAccountId: null, toAccountId: null, accountDates: ['a1|2026-03-15T00:00:00.000Z'] },
  { id: 'cf-c1-2026-02', type: 'EXPENSE', amount: '18000', currency: 'COP', date: '2026-03-15T00:00:00.000Z', description: 'Manejo Visa (febrero 2026)', category: 'Intereses y manejo', accountId: 'a1', fromAccountId: null, toAccountId: null, accountDates: ['a1|2026-03-15T00:00:00.000Z'] },
];
const SEED = { account: ACCOUNT, card: CARD, purchase: PURCHASE, payments: PAYMENTS };

async function seedV2(page: Page): Promise<void> {
  await page.evaluate(
    (seed) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('mis-finanzas', 2);
        req.onerror = () => reject(req.error);
        req.onupgradeneeded = () => {
          const db = req.result;
          db.createObjectStore('accounts', { keyPath: 'id' });
          const tx = db.createObjectStore('transactions', { keyPath: 'id' });
          tx.createIndex('by-date', 'date');
          tx.createIndex('by-account-date', 'accountDates', { multiEntry: true });
          db.createObjectStore('scheduledExpenses', { keyPath: 'id' }).createIndex('by-account', 'accountId');
          db.createObjectStore('meta', { keyPath: 'key' });
          db.createObjectStore('scheduledIncomes', { keyPath: 'id' }).createIndex('by-account', 'accountId');
          db.createObjectStore('creditCards', { keyPath: 'id' });
          db.createObjectStore('cardPurchases', { keyPath: 'id' }).createIndex('by-card', 'cardId');
        };
        req.onsuccess = () => {
          const db = req.result;
          const t = db.transaction(['accounts', 'transactions', 'creditCards', 'cardPurchases', 'meta'], 'readwrite');
          t.objectStore('accounts').put(seed.account);
          t.objectStore('creditCards').put(seed.card);
          t.objectStore('cardPurchases').put(seed.purchase);
          for (const p of seed.payments) t.objectStore('transactions').put(p);
          t.objectStore('meta').put({ key: 'lastBackupAt', value: '2026-03-01T00:00:00.000Z' });
          t.oncomplete = () => {
            db.close();
            resolve();
          };
          t.onerror = () => reject(t.error);
        };
      }),
    SEED,
  );
}

/** Abre la base sin pedir versión y devuelve todas sus filas, para comprobar que nada cambió. */
async function dump(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ version: number; stores: string[]; rows: Record<string, unknown[]>; paymentIndex: { keyPath: unknown; unique: boolean } }>(
        (resolve, reject) => {
          const req = indexedDB.open('mis-finanzas');
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const db = req.result;
            const stores = [...db.objectStoreNames].sort();
            const t = db.transaction(stores, 'readonly');
            const rows: Record<string, unknown[]> = {};
            for (const s of stores) {
              const all = t.objectStore(s).getAll();
              all.onsuccess = () => (rows[s] = all.result);
            }
            const index = t.objectStore('cardPayments').index('by-card');
            const paymentIndex = { keyPath: index.keyPath, unique: index.unique };
            t.oncomplete = () => {
              db.close();
              resolve({ version: db.version, stores, rows, paymentIndex });
            };
            t.onerror = () => reject(t.error);
          };
        },
      ),
  );
}

async function expectIntact(page: Page): Promise<void> {
  const info = await dump(page);
  expect(info.version).toBe(3);
  expect(info.stores).toEqual(['accounts', 'cardPayments', 'cardPurchases', 'creditCards', 'meta', 'scheduledExpenses', 'scheduledIncomes', 'transactions']);
  expect(info.rows['accounts']).toEqual([ACCOUNT]);
  expect(info.rows['creditCards']).toEqual([CARD]);
  expect(info.rows['cardPurchases']).toEqual([PURCHASE]);
  expect(info.rows['transactions']).toEqual([...PAYMENTS].sort((a, b) => a.id.localeCompare(b.id)));
  expect(info.rows['meta']).toEqual([{ key: 'lastBackupAt', value: '2026-03-01T00:00:00.000Z' }]);
  expect(info.rows['cardPayments']).toEqual([]);
  expect(info.paymentIndex).toEqual({ keyPath: ['cardId', 'seq'], unique: true });
}

const heading = (page: Page) => page.getByRole('heading', { level: 1, name: 'Inicio' });

test('una base v2 con tarjetas, compras y pagos de hoy se actualiza a v3 intacta y sin errores', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto(SEED_PAGE);
  await seedV2(page);
  await page.goto('./');
  await expect(heading(page)).toBeVisible();
  await expect(page.getByText('Bancolombia').first()).toBeVisible();
  await expectIntact(page);

  await page.reload();
  await expect(heading(page)).toBeVisible();
  await expectIntact(page);
  expect(errors).toEqual([]);
  await context.close();
});
