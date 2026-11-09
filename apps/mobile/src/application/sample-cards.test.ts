import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openFinanzasDb, type FinanzasDb } from '@/data/database';
import { createServices, type AppServices } from './create-services';
import { SAMPLE_PREFIX } from './sample-data';

let dbName = '';
let db: FinanzasDb;
let s: AppServices;
let seq = 0;

beforeEach(async () => {
  dbName = `sample-cards-${Math.random()}`;
  db = await openFinanzasDb(dbName);
  seq = 0;
  s = createServices({ db, now: () => new Date('2026-03-10T15:00:00Z'), newId: () => `id-${++seq}` });
});
afterEach(async () => {
  db.close();
  await deleteDB(dbName);
});

const count = async () => [await db.count('creditCards'), await db.count('cardPurchases')];

describe('datos de ejemplo con tarjeta', () => {
  it('traen una tarjeta y una compra con prefijo demo-, sin vencidas', async () => {
    await s.data.loadSample();
    expect(await count()).toEqual([1, 1]);
    const [card] = await s.cards.list();
    expect(card!.id.startsWith(SAMPLE_PREFIX)).toBe(true);
    expect(card!.purchases[0]!.id.startsWith(SAMPLE_PREFIX)).toBe(true);
    expect(card!.next!.date).toBe('2026-04-15');
    expect(card!.debt).toBe('1200000');
  });

  it('Quitar datos de ejemplo se lleva tarjeta, compra y sus pagos, aunque salgan de una cuenta propia', async () => {
    await s.data.loadSample();
    await s.accounts.create({ name: 'Mía', type: 'BANK', initialBalance: '1000000' });
    const mine = (await s.accounts.list()).find((a) => a.name === 'Mía')!;
    const [card] = await s.cards.list();
    await s.cards.payInstallment(card!.purchases[0]!.id, { fromAccountId: mine.id, paidOn: '2026-03-10' });
    await s.cards.payFee(card!.id, '2026-03', { fromAccountId: mine.id, paidOn: '2026-03-10' });
    expect(await s.data.removeSample()).toEqual({ ok: true });
    expect(await count()).toEqual([0, 0]);
    expect(await db.getAll('transactions')).toEqual([]);
    expect((await s.accounts.list()).map((a) => a.name)).toEqual(['Mía']);
  });

  it('Quitar datos de ejemplo conserva lo propio', async () => {
    await s.accounts.create({ name: 'Mía', type: 'BANK', initialBalance: '1000000' });
    const [mine] = await s.accounts.list();
    await s.cards.createCard({ name: 'Propia', dueDay: 10, paymentAccountId: mine!.id, feeKind: 'NONE' });
    const [card] = await s.cards.list();
    await s.cards.addPurchase({ cardId: card!.id, description: 'Propia', amount: '1000', installments: 1, purchaseDate: '2026-03-01', firstDueDate: '2026-04-10' });
    const [purchase] = (await s.cards.list())[0]!.purchases;
    await s.cards.payInstallment(purchase!.id, { fromAccountId: mine!.id, paidOn: '2026-03-10' });
    expect(await s.data.removeSample()).toEqual({ ok: true });
    expect(await count()).toEqual([1, 1]);
    expect((await db.getAll('transactions')).map((t) => t.id)).toEqual([`cp-${purchase!.id}-1`]);
  });

  it('Borrar todo no deja tarjetas ni compras', async () => {
    await s.data.loadSample();
    expect(await s.data.eraseAll()).toEqual({ ok: true });
    expect(await count()).toEqual([0, 0]);
    expect(await s.cards.list()).toEqual([]);
  });
});
