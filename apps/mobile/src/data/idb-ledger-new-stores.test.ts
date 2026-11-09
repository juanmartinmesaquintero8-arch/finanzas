import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServices } from '@/application/create-services';
import { SAMPLE_PREFIX } from '@/application/sample-data';
import { openFinanzasDb, type FinanzasDb, type StoredCardPurchase, type StoredCreditCard, type StoredScheduledIncome } from './database';
import { IdbLedgerStore } from './idb-ledger-store';

let name = '';
let db: FinanzasDb;
let n = 0;

beforeEach(async () => {
  name = `ledger-new-${++n}-${Math.random()}`;
  db = await openFinanzasDb(name);
});
afterEach(async () => {
  db.close();
  await deleteDB(name);
});

const income = (id: string, accountId: string): StoredScheduledIncome => ({
  id, description: 'Nómina', amount: '100', currency: 'COP', accountId, frequency: 'MONTHLY', startDate: '2026-04-30', endDate: null, settledThrough: null,
});
const card = (id: string, paymentAccountId: string): StoredCreditCard => ({
  id, name: 'Visa', dueDay: 15, paymentAccountId, feeKind: 'NONE', feeAmount: null, currency: 'COP', rateBasis: null, ratePpm: null, feeStartMonth: '2026-03', feesSettledThrough: null,
});
const purchase = (id: string, cardId: string): StoredCardPurchase => ({
  id, cardId, description: 'TV', category: null, amount: '100', currency: 'COP', installments: 1, purchaseDate: '2026-03-01', firstDueDate: '2026-04-15', monthlyRatePpm: 0, paidInstallments: 0, closedOn: null,
});

async function fillNew() {
  await db.put('scheduledIncomes', income('mine-i', 'mine-a'));
  await db.put('scheduledIncomes', income(`${SAMPLE_PREFIX}i`, `${SAMPLE_PREFIX}a`));
  await db.put('creditCards', card('mine-c', 'mine-a'));
  await db.put('creditCards', card(`${SAMPLE_PREFIX}c`, `${SAMPLE_PREFIX}a`));
  await db.put('cardPurchases', purchase('mine-p', 'mine-c'));
  await db.put('cardPurchases', purchase(`${SAMPLE_PREFIX}p`, `${SAMPLE_PREFIX}c`));
}
const counts = async () => [
  await db.count('scheduledIncomes'),
  await db.count('creditCards'),
  await db.count('cardPurchases'),
];

describe('almacenes nuevos en las operaciones de todo el libro', () => {
  it('replaceAll (recuperar copia sin ellos) los deja vacíos', async () => {
    await fillNew();
    await new IdbLedgerStore(db).replaceAll({ accounts: [], transactions: [], scheduledExpenses: [] });
    expect(await counts()).toEqual([0, 0, 0]);
  });

  it('replaceAll con filas extra las guarda', async () => {
    await new IdbLedgerStore(db).replaceAll(
      { accounts: [], transactions: [], scheduledExpenses: [] },
      { scheduledIncomes: [income('x', 'a')], creditCards: [card('c', 'a')], cardPurchases: [purchase('p', 'c')] },
    );
    expect(await counts()).toEqual([1, 1, 1]);
  });

  it('clearAll los vacía', async () => {
    await fillNew();
    await new IdbLedgerStore(db).clearAll();
    expect(await counts()).toEqual([0, 0, 0]);
  });

  it('removeSample quita sólo lo de ejemplo y conserva lo propio de los almacenes nuevos', async () => {
    await fillNew();
    const s = createServices({ db });
    expect(await s.data.removeSample()).toEqual({ ok: true });
    expect((await db.getAll('scheduledIncomes')).map((r) => r.id)).toEqual(['mine-i']);
    expect((await db.getAll('creditCards')).map((r) => r.id)).toEqual(['mine-c']);
    expect((await db.getAll('cardPurchases')).map((r) => r.id)).toEqual(['mine-p']);
  });

  it('eraseAll los vacía', async () => {
    await fillNew();
    const s = createServices({ db });
    expect(await s.data.eraseAll()).toEqual({ ok: true });
    expect(await counts()).toEqual([0, 0, 0]);
  });
});
