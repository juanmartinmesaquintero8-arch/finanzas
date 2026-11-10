import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openFinanzasDb, type FinanzasDb } from '@/data/database';
import { createServices, type AppServices } from './create-services';

let dbName = '';
let db: FinanzasDb;
let s: AppServices;
let seq = 0;
let accountId = '';
let now = new Date('2026-01-10T15:00:00Z');
const at = (day: string) => {
  now = new Date(`${day}T15:00:00Z`);
};

beforeEach(async () => {
  now = new Date('2026-01-10T15:00:00Z');
  dbName = `card-cut-cyc-${Math.random()}`;
  db = await openFinanzasDb(dbName);
  seq = 0;
  s = createServices({ db, now: () => now, newId: () => `id-${++seq}` });
  await s.accounts.create({ name: 'Banco', type: 'BANK', initialBalance: '10000000' });
  accountId = (await s.accounts.list())[0]!.id;
});
afterEach(async () => {
  db.close();
  await deleteDB(dbName);
});

const cardInput = (over = {}) => ({ name: 'Visa', dueDay: 25, cutDay: 10, paymentAccountId: accountId, feeKind: 'ON_MOVEMENT' as const, feeAmount: '18000', ...over });
const purchaseInput = (cardId: string, over = {}) => ({ cardId, description: 'Compra', amount: '100000', installments: 1, purchaseDate: '2026-03-05', firstDueDate: '2026-03-25', ...over });
const LATE = 'Esa compra es de un mes con manejo ya pagado, así que no se generó una cuota nueva.';

describe('aviso de compra tardía con corte (usa el ciclo de facturación)', () => {
  async function paidThroughMarch() {
    await s.cards.createCard(cardInput());
    const card = (await s.cards.list())[0]!;
    await s.cards.addPurchase(purchaseInput(card.id));
    at('2026-04-10');
    expect(await s.cards.payFee(card.id, '2026-03', { fromAccountId: accountId, paidOn: '2026-04-10' })).toEqual({ ok: true });
    return card;
  }

  it('compra del 20 de marzo es del ciclo de abril: no avisa', async () => {
    const card = await paidThroughMarch();
    expect(await s.cards.addPurchase(purchaseInput(card.id, { purchaseDate: '2026-03-20', firstDueDate: '2026-04-25' }))).toEqual({ ok: true });
  });

  it('compra del 5 de febrero es del ciclo de febrero, ya pagado: avisa', async () => {
    const card = await paidThroughMarch();
    expect(await s.cards.addPurchase(purchaseInput(card.id, { purchaseDate: '2026-02-05', firstDueDate: '2026-02-25' }))).toEqual({ ok: true, notice: LATE });
  });

  it('compra del 20 de febrero cae en el ciclo de marzo, que ya tenía movimiento: no avisa', async () => {
    const card = await paidThroughMarch();
    expect(await s.cards.addPurchase(purchaseInput(card.id, { purchaseDate: '2026-02-20', firstDueDate: '2026-03-25' }))).toEqual({ ok: true });
  });

  it('editar la fecha dentro del mismo ciclo no avisa; pasarla a un ciclo cerrado sin movimiento sí', async () => {
    const card = await paidThroughMarch();
    await s.cards.addPurchase(purchaseInput(card.id, { description: 'Abril', purchaseDate: '2026-04-15', firstDueDate: '2026-04-25' }));
    const p = (await db.getAll('cardPurchases')).find((r) => r.description === 'Abril')!;
    expect(await s.cards.updatePurchase(p.id, purchaseInput(card.id, { description: 'Abril', purchaseDate: '2026-04-20', firstDueDate: '2026-04-25' }))).toEqual({ ok: true });
    expect(await s.cards.updatePurchase(p.id, purchaseInput(card.id, { description: 'Abril', purchaseDate: '2026-02-05', firstDueDate: '2026-02-25' }))).toEqual({ ok: true, notice: LATE });
  });
});

describe('primer manejo: nunca un ciclo que ya cerró', () => {
  it('corte 10, pago 25, hoy 28 de marzo, manejo fijo: la primera cuota es del ciclo de abril', async () => {
    at('2026-03-28');
    await s.cards.createCard(cardInput({ feeKind: 'FIXED_MONTHLY' }));
    const [card] = await s.cards.list();
    expect(card!.pendingFees[0]).toEqual({ month: '2026-04', dueDate: '2026-04-25', amount: '18000' });
  });

  it('el día del corte todavía es el ciclo abierto', async () => {
    at('2026-03-10');
    await s.cards.createCard(cardInput({ feeKind: 'FIXED_MONTHLY' }));
    expect((await s.cards.list())[0]!.pendingFees[0]!.month).toBe('2026-03');
  });

  it('sin corte sigue como hoy: el mes calendario', async () => {
    at('2026-03-28');
    await s.cards.createCard(cardInput({ cutDay: undefined, feeKind: 'FIXED_MONTHLY' }));
    expect((await s.cards.list())[0]!.pendingFees[0]!.month).toBe('2026-03');
  });

  it('al activar el manejo en una tarjeta con corte, también empieza en el ciclo abierto', async () => {
    at('2026-03-28');
    await s.cards.createCard(cardInput({ feeKind: 'NONE', feeAmount: undefined }));
    const id = (await s.cards.list())[0]!.id;
    await s.cards.updateCard(id, cardInput({ feeKind: 'FIXED_MONTHLY' }));
    expect((await s.cards.list())[0]!.pendingFees[0]!.month).toBe('2026-04');
  });
});

describe('aviso de cambio de corte: fechas movidas y cuotas nuevas', () => {
  it('pasar de corte 20 a corte 10 mueve una fecha y hace aparecer una cuota', async () => {
    at('2026-03-10');
    await s.cards.createCard(cardInput({ dueDay: 15, cutDay: 20, feeKind: 'FIXED_MONTHLY' }));
    const id = (await s.cards.list())[0]!.id;
    expect(await s.cards.cardChangeImpact(id, cardInput({ dueDay: 15, cutDay: 10, feeKind: 'FIXED_MONTHLY' }))).toEqual({
      lostCount: 0,
      lostAmount: '0',
      changedCount: 0,
      movedCount: 1,
      newCount: 1,
      newAmount: '18000',
    });
  });
});
