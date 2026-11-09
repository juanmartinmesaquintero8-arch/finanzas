import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openFinanzasDb, type FinanzasDb } from '@/data/database';
import { previewPurchase } from './card-service';
import { createServices, type AppServices } from './create-services';

let dbName = '';
let db: FinanzasDb;
let s: AppServices;
let seq = 0;
let accountId = '';
let now = new Date('2026-03-10T15:00:00Z');
const at = (iso: string) => (now = new Date(`${iso}T15:00:00Z`));

beforeEach(async () => {
  at('2026-03-10');
  dbName = `round1-${Math.random()}`;
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

const cardInput = (over = {}) => ({ name: 'Visa', dueDay: 15, paymentAccountId: accountId, feeKind: 'NONE' as const, rateBasis: 'MV' as const, rateText: '2', ...over });
const purchaseInput = (cardId: string, over = {}) => ({ cardId, description: 'Nevera', amount: '1200000', installments: 12, purchaseDate: '2026-03-02', firstDueDate: '2026-04-15', category: 'Hogar', ...over });
const onMovement = { feeKind: 'ON_MOVEMENT' as const, feeAmount: '18000' };
const monthly = { feeKind: 'FIXED_MONTHLY' as const, feeAmount: '18000' };

async function newCard(over = {}) {
  await s.cards.createCard(cardInput(over));
  return (await s.cards.list())[0]!;
}
async function newPurchase(cardId: string, over = {}) {
  await s.cards.addPurchase(purchaseInput(cardId, over));
  const description = (over as { description?: string }).description ?? 'Nevera';
  return (await db.getAll('cardPurchases')).find((p) => p.description === description)!;
}
const pay = (over = {}) => ({ fromAccountId: accountId, paidOn: '2026-04-15', ...over });
const view = async (id: string) => (await s.transactions.page({ limit: 100 })).items.find((t) => t.id === id);
const pendingMonths = async () => (await s.cards.list())[0]!.pendingFees.map((f) => f.month);
const worth = async () => (await s.summary.projection(s.today())).netWorth.amount;

const INSTALLMENT = 'Este pago viene de una tarjeta. Para deshacerlo, usa «Deshacer último pago» en la tarjeta.';
const SETTLED = 'Este pago liquidó una compra y no se puede deshacer.';
const FEE = 'Para deshacer este pago, usa «Deshacer último pago de manejo» en la tarjeta.';
const edit = { type: 'EXPENSE' as const, amount: '1', date: '2026-04-15', description: 'x', accountId };

describe('I1/I2: pagos de tarjeta en el historial', () => {
  it('cuota de una compra abierta: marcado y sin borrar', async () => {
    const card = await newCard();
    const p = await newPurchase(card.id);
    await s.cards.payInstallment(p.id, pay());
    for (const id of [`cp-${p.id}-1`, `ci-${p.id}-1`]) {
      expect((await view(id))!.cardPayment).toEqual({ message: INSTALLMENT, canDelete: false });
      expect((await s.transactions.get(id))!.cardPayment).toEqual({ message: INSTALLMENT, canDelete: false });
      expect(await s.transactions.remove(id)).toEqual({ ok: false, error: INSTALLMENT });
      expect(await s.transactions.update(id, edit)).toEqual({ ok: false, error: INSTALLMENT });
    }
  });

  it('pago de liquidación', async () => {
    const card = await newCard();
    const p = await newPurchase(card.id);
    await s.cards.settle(p.id, pay());
    expect((await view(`cp-${p.id}-liq`))!.cardPayment).toEqual({ message: SETTLED, canDelete: false });
    expect(await s.transactions.remove(`ci-${p.id}-liq`)).toEqual({ ok: false, error: SETTLED });
  });

  it('una cuota vieja de una compra que luego se liquidó tampoco se puede deshacer', async () => {
    const card = await newCard();
    const p = await newPurchase(card.id);
    await s.cards.payInstallment(p.id, pay());
    await s.cards.settle(p.id, pay());
    const closed = 'Esta compra ya se liquidó, así que este pago no se puede deshacer.';
    expect((await view(`cp-${p.id}-1`))!.cardPayment).toEqual({ message: closed, canDelete: false });
    expect(await s.transactions.remove(`cp-${p.id}-1`)).toEqual({ ok: false, error: closed });
  });

  it('manejo de una tarjeta que existe', async () => {
    const card = await newCard(monthly);
    await s.cards.payFee(card.id, '2026-03', pay());
    const id = `cf-${card.id}-2026-03`;
    expect((await view(id))!.cardPayment).toEqual({ message: FEE, canDelete: false });
    expect(await s.transactions.remove(id)).toEqual({ ok: false, error: FEE });
  });

  it('si la compra ya no existe: se puede eliminar, pero no editar', async () => {
    const card = await newCard();
    const p = await newPurchase(card.id);
    await s.cards.payInstallment(p.id, pay());
    await s.cards.removePurchase(p.id);
    const id = `cp-${p.id}-1`;
    expect((await view(id))!.cardPayment!.canDelete).toBe(true);
    expect(await s.transactions.update(id, edit)).toMatchObject({ ok: false });
    expect((await db.get('transactions', id))!.amount).toBe('100000');
    expect(await s.transactions.remove(id)).toEqual({ ok: true });
    expect(await db.get('transactions', id)).toBeUndefined();
  });

  it('si la tarjeta ya no existe: su manejo se puede eliminar', async () => {
    const card = await newCard(monthly);
    await s.cards.payFee(card.id, '2026-03', pay());
    await s.cards.removeCard(card.id);
    const id = `cf-${card.id}-2026-03`;
    expect((await view(id))!.cardPayment!.canDelete).toBe(true);
    expect(await s.transactions.remove(id)).toEqual({ ok: true });
  });

  it('un movimiento normal no se marca', async () => {
    await s.transactions.create({ ...edit, accountId });
    const [item] = (await s.transactions.page({})).items;
    expect(item!.cardPayment).toBeUndefined();
    expect(await s.transactions.remove(item!.id)).toEqual({ ok: true });
  });
});

describe('I3: undoLastFee', () => {
  it('meses seguidos: borra el gasto, devuelve el dinero y deja pendiente esa cuota', async () => {
    const card = await newCard(monthly);
    at('2026-05-10');
    await s.cards.payFee(card.id, '2026-03', pay({ paidOn: '2026-05-10' }));
    const before = await worth();
    await s.cards.payFee(card.id, '2026-04', pay({ paidOn: '2026-05-10' }));
    expect((await s.cards.list())[0]!.lastPaidFeeMonth).toBe('2026-04');
    expect(await s.cards.undoLastFee(card.id)).toEqual({ ok: true });
    expect(await db.get('transactions', `cf-${card.id}-2026-04`)).toBeUndefined();
    expect(await db.get('transactions', `cf-${card.id}-2026-03`)).toBeDefined();
    expect((await db.get('creditCards', card.id))!.feesSettledThrough).toBe('2026-03');
    expect(await pendingMonths()).toEqual(['2026-04', '2026-05']);
    expect(await worth()).toBe(before);
    expect((await s.cards.list())[0]!.lastPaidFeeMonth).toBe('2026-03');
  });

  it('el primer mes pagado deja la tarjeta sin marca', async () => {
    const card = await newCard(monthly);
    await s.cards.payFee(card.id, '2026-03', pay());
    await s.cards.undoLastFee(card.id);
    expect((await db.get('creditCards', card.id))!.feesSettledThrough).toBeNull();
    expect((await s.cards.list())[0]!.lastPaidFeeMonth).toBeNull();
    expect(await s.cards.undoLastFee(card.id)).toEqual({ ok: false, error: 'Esta tarjeta no tiene pagos de manejo para deshacer.' });
  });

  describe('con movimiento y meses no seguidos', () => {
    async function janAndMarPaid() {
      at('2026-01-10');
      const card = await newCard(onMovement);
      await newPurchase(card.id, { description: 'Ene', purchaseDate: '2026-01-05', firstDueDate: '2026-02-15' });
      at('2026-03-10');
      await newPurchase(card.id, { description: 'Mar', purchaseDate: '2026-03-05', firstDueDate: '2026-04-15' });
      at('2026-04-10');
      await s.cards.payFee(card.id, '2026-01', pay({ paidOn: '2026-04-10' }));
      await s.cards.payFee(card.id, '2026-03', pay({ paidOn: '2026-04-10' }));
      return card;
    }

    it('deshacer marzo deja pendiente solo marzo, y enero sigue pagado', async () => {
      const card = await janAndMarPaid();
      expect(await pendingMonths()).toEqual([]);
      await s.cards.undoLastFee(card.id);
      expect(await pendingMonths()).toEqual(['2026-03']);
      expect((await s.cards.list())[0]!.lastPaidFeeMonth).toBe('2026-01');
      expect(await db.get('transactions', `cf-${card.id}-2026-01`)).toBeDefined();
    });

    it('volver a deshacer llega a enero aunque febrero no tuvo manejo', async () => {
      const card = await janAndMarPaid();
      await s.cards.undoLastFee(card.id);
      await s.cards.undoLastFee(card.id);
      expect(await pendingMonths()).toEqual(['2026-01', '2026-03']);
      expect((await db.get('creditCards', card.id))!.feesSettledThrough).toBeNull();
      expect(await db.get('transactions', `cf-${card.id}-2026-01`)).toBeUndefined();
    });

    it('volver a pagar lo deshecho funciona y no duplica', async () => {
      const card = await janAndMarPaid();
      await s.cards.undoLastFee(card.id);
      expect(await s.cards.payFee(card.id, '2026-03', pay({ paidOn: '2026-04-10' }))).toEqual({ ok: true });
      expect((await db.getAll('transactions')).filter((t) => t.id.startsWith('cf-'))).toHaveLength(2);
      expect(await pendingMonths()).toEqual([]);
    });

    it('una tarjeta con id parecido no se confunde', async () => {
      const card = await janAndMarPaid();
      await db.put('transactions', { ...(await db.get('transactions', `cf-${card.id}-2026-03`))!, id: `cf-${card.id}-x-2026-05` });
      expect((await s.cards.list())[0]!.lastPaidFeeMonth).toBe('2026-03');
    });
  });

  it('doble toque: simultáneo no borra dos; repetido con el mismo mes tampoco', async () => {
    const card = await newCard(monthly);
    at('2026-05-10');
    await s.cards.payFee(card.id, '2026-03', pay({ paidOn: '2026-05-10' }));
    await s.cards.payFee(card.id, '2026-04', pay({ paidOn: '2026-05-10' }));
    await Promise.all([s.cards.undoLastFee(card.id), s.cards.undoLastFee(card.id)]);
    expect(await db.get('transactions', `cf-${card.id}-2026-03`)).toBeDefined();
    expect((await db.get('creditCards', card.id))!.feesSettledThrough).toBe('2026-03');
    await s.cards.payFee(card.id, '2026-04', pay({ paidOn: '2026-05-10' }));
    await s.cards.undoLastFee(card.id, { month: '2026-04' });
    expect(await s.cards.undoLastFee(card.id, { month: '2026-04' })).toEqual({ ok: true });
    expect(await db.get('transactions', `cf-${card.id}-2026-03`)).toBeDefined();
  });
});

describe('I5: deshacer mezclando cuotas ya pagadas y pagos reales', () => {
  it('el pago real devuelve el dinero; la marcada como ya pagada no cambia ningún saldo', async () => {
    const card = await newCard();
    const p = await newPurchase(card.id, { paidInstallments: 2 });
    const start = await worth();
    await s.cards.payInstallment(p.id, pay({ paidOn: '2026-03-10' }));
    expect(BigInt(await worth())).toBeLessThan(BigInt(start));
    await s.cards.undoLastPayment(p.id);
    expect(await worth()).toBe(start);
    expect((await db.get('cardPurchases', p.id))!.paidInstallments).toBe(2);
    expect(await s.cards.undoLastPayment(p.id)).toEqual({ ok: true });
    expect(await worth()).toBe(start);
    expect((await db.get('cardPurchases', p.id))!.paidInstallments).toBe(1);
  });
});

describe('I6: avisar antes de perder cuotas de manejo', () => {
  const none = { lostCount: 0, lostAmount: '0', changedCount: 0 };

  it('a Todos los meses: se pierde lo pendiente de antes de hoy', async () => {
    const card = await newCard(onMovement);
    await newPurchase(card.id);
    at('2026-04-10');
    expect(await s.cards.cardChangeImpact(card.id, cardInput(monthly))).toEqual({ lostCount: 1, lostAmount: '18000', changedCount: 0 });
  });

  it('a Solo los meses que uso: se pierden los meses sin compra', async () => {
    const card = await newCard(monthly);
    await newPurchase(card.id);
    at('2026-05-10');
    expect(await s.cards.cardChangeImpact(card.id, cardInput(onMovement))).toEqual({ lostCount: 2, lostAmount: '36000', changedCount: 0 });
  });

  it('a No cobra: se pierden todas', async () => {
    const card = await newCard(monthly);
    at('2026-05-10');
    expect(await s.cards.cardChangeImpact(card.id, cardInput())).toEqual({ lostCount: 3, lostAmount: '54000', changedCount: 0 });
  });

  it('cambiar el valor: cambian las pendientes', async () => {
    const card = await newCard(monthly);
    at('2026-05-10');
    expect(await s.cards.cardChangeImpact(card.id, cardInput({ ...monthly, feeAmount: '20000' }))).toEqual({ lostCount: 0, lostAmount: '0', changedCount: 3 });
    expect(await s.cards.cardChangeImpact(card.id, cardInput({ ...monthly, name: 'Otra' }))).toEqual(none);
  });

  it('borrar la única compra del mes pierde esa cuota; si hay otra, no', async () => {
    const card = await newCard(onMovement);
    const p = await newPurchase(card.id);
    expect(await s.cards.purchaseRemovalImpact(p.id)).toEqual({ lostCount: 1, lostAmount: '18000', changedCount: 0 });
    await newPurchase(card.id, { description: 'Otra' });
    expect(await s.cards.purchaseRemovalImpact(p.id)).toEqual(none);
  });

  it('cambiar la fecha a otro mes pierde la cuota del mes que queda sin compra', async () => {
    at('2026-02-10');
    const card = await newCard(onMovement);
    at('2026-03-10');
    const p = await newPurchase(card.id);
    expect(await s.cards.purchaseChangeImpact(p.id, purchaseInput(card.id, { purchaseDate: '2026-02-20' }))).toEqual({ lostCount: 1, lostAmount: '18000', changedCount: 0 });
    expect(await s.cards.purchaseChangeImpact(p.id, purchaseInput(card.id, { purchaseDate: '2026-03-20' }))).toEqual(none);
  });

  it('una entrada inválida no reporta pérdidas: la rechaza el guardado', async () => {
    const card = await newCard(monthly);
    expect(await s.cards.cardChangeImpact(card.id, cardInput({ dueDay: 99 }))).toEqual(none);
    expect(await s.cards.cardChangeImpact('nope', cardInput())).toEqual(none);
  });

  const LATE = 'Esa compra es de un mes con manejo ya pagado, así que no se generó una cuota nueva.';

  it('compra de un mes con manejo ya pagado: lo avisa al guardar', async () => {
    at('2026-01-10');
    const card = await newCard(onMovement);
    await newPurchase(card.id, { description: 'Mar', purchaseDate: '2026-03-05', firstDueDate: '2026-04-15' });
    at('2026-04-10');
    await s.cards.payFee(card.id, '2026-03', pay({ paidOn: '2026-04-10' }));
    expect(await s.cards.addPurchase(purchaseInput(card.id, { description: 'Feb', purchaseDate: '2026-02-05', firstDueDate: '2026-03-15' }))).toEqual({ ok: true, notice: LATE });
    expect(await pendingMonths()).toEqual([]);
    expect(await s.cards.addPurchase(purchaseInput(card.id, { description: 'Otra', purchaseDate: '2026-04-05', firstDueDate: '2026-05-15' }))).toEqual({ ok: true });
    expect(await s.cards.addPurchase(purchaseInput(card.id, { description: 'Otra mar', purchaseDate: '2026-03-20', firstDueDate: '2026-04-15' }))).toEqual({ ok: true });
  });
});

describe('I7: editar una compra', () => {
  it('no se puede pasar a otra tarjeta, ni con cuotas pagadas', async () => {
    const card = await newCard();
    await s.cards.createCard(cardInput({ name: 'Zeta' }));
    const other = (await s.cards.list()).find((c) => c.name === 'Zeta')!;
    const p = await newPurchase(card.id);
    const error = 'Una compra no se puede pasar a otra tarjeta.';
    expect(await s.cards.updatePurchase(p.id, purchaseInput(other.id))).toEqual({ ok: false, error });
    await s.cards.payInstallment(p.id, pay());
    expect(await s.cards.updatePurchase(p.id, purchaseInput(other.id))).toEqual({ ok: false, error });
    expect((await db.get('cardPurchases', p.id))!.cardId).toBe(card.id);
  });

  it('la vista previa de una edición usa la tasa pactada, no la actual', async () => {
    const card = await newCard();
    await newPurchase(card.id);
    await s.cards.updateCard(card.id, cardInput({ rateText: '3' }));
    const [updated] = await s.cards.list();
    const purchase = updated!.purchases[0]!;
    const result = previewPurchase(updated!, purchaseInput(card.id), purchase);
    if (!result.ok) throw new Error(result.error);
    expect(result.preview.totalInterest).toBe('156000');
    const fresh = previewPurchase(updated!, purchaseInput(card.id));
    if (!fresh.ok) throw new Error(fresh.error);
    expect(fresh.preview.totalInterest).toBe('234000');
  });
});

describe('M3 y M6', () => {
  it('M3: el movimiento y el compromiso dicen el mes en palabras', async () => {
    const card = await newCard(monthly);
    await s.cards.payFee(card.id, '2026-03', pay());
    expect((await db.get('transactions', `cf-${card.id}-2026-03`))!.description).toBe('Manejo Visa (marzo 2026)');
    const projection = await s.summary.projection('2026-05-31');
    expect(projection.commitments[0]!.description).toBe('Manejo Visa (abril 2026)');
  });

  it('M6: no se paga una cuota con fecha anterior a la compra', async () => {
    const card = await newCard();
    const p = await newPurchase(card.id);
    expect(await s.cards.payInstallment(p.id, pay({ paidOn: '2026-03-01' }))).toEqual({ ok: false, error: 'El pago no puede ser anterior a la compra.' });
    expect(await db.count('transactions')).toBe(0);
    expect(await s.cards.payInstallment(p.id, pay({ paidOn: '2026-03-02' }))).toEqual({ ok: true });
  });
});
