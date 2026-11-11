import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openFinanzasDb, type FinanzasDb } from '@/data/database';
import { createServices, type AppServices } from './create-services';

// Lo que la pantalla «Pagar tarjeta» necesita del servicio: atajos, desglose completo, estado de la lista y la garantía
// de que lo que se confirma es exactamente lo que se mostró.

let dbName = '';
let db: FinanzasDb;
let s: AppServices;
let seq = 0;
let accountId = '';
let now = new Date('2026-03-10T15:00:00Z');

const APRIL_15 = new Date('2026-04-15T17:00:00Z');
const MAY_10 = new Date('2026-05-10T17:00:00Z');
const APRIL_10 = new Date('2026-04-10T17:00:00Z');
const OTHER_VALUES = 'Ya registraste un pago con otros valores. Cierra el formulario y revisa el historial de la tarjeta.';
const CARD_CHANGED = 'La tarjeta cambió mientras registrabas el pago. Revisa el desglose e inténtalo de nuevo.';

beforeEach(async () => {
  now = new Date('2026-03-10T15:00:00Z');
  dbName = `card-screen-${Math.random()}`;
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

/** Visa 2 % MV, pago el 15. «Nevera» 1.200.000 a 12 cuotas: la 1 vale 100.000 + 24.000 el 15 de abril. */
async function setup(over: Record<string, unknown> = {}) {
  await s.cards.createCard({ name: 'Visa', dueDay: 15, paymentAccountId: accountId, feeKind: 'NONE', rateBasis: 'MV', rateText: '2', ...over });
  const cardId = (await s.cards.list())[0]!.id;
  await s.cards.addPurchase({ cardId, description: 'Nevera', amount: '1200000', installments: 12, purchaseDate: '2026-03-02', firstDueDate: '2026-04-15', category: 'Hogar' });
  const purchaseId = (await db.getAll('cardPurchases'))[0]!.id;
  now = APRIL_15;
  return { cardId, purchaseId };
}

async function addSofa(cardId: string) {
  const at = now;
  now = new Date('2026-03-10T15:00:00Z');
  await s.cards.addPurchase({ cardId, description: 'Sofá', amount: '600000', installments: 6, purchaseDate: '2026-03-05', firstDueDate: '2026-04-15', withoutInterest: true });
  now = at;
  return (await db.getAll('cardPurchases')).find((p) => p.description === 'Sofá')!.id;
}

const pay = (over: Record<string, unknown> = {}) => ({ amount: '50000', paidOn: '2026-04-15', fromAccountId: accountId, ...over });
const cardView = async () => (await s.cards.list())[0]!;

describe('atajos del formulario', () => {
  it('«Lo de este mes» es lo del periodo y «Todo» el máximo, al día del pago', async () => {
    const { cardId } = await setup();
    expect(await s.cards.paymentShortcuts(cardId, '2026-04-15')).toEqual({ ok: true, thisMonth: '124000', max: '1224000' });
  });

  it('con algo vencido, «Lo de este mes» suma lo vencido y lo del periodo', async () => {
    const { cardId } = await setup();
    now = MAY_10;
    // Vencida la 1 (124.000) y del periodo la 2 (100.000 + 22.000). El máximo ya suma el interés facturado de la 2.
    expect(await s.cards.paymentShortcuts(cardId, '2026-05-10')).toEqual({ ok: true, thisMonth: '246000', max: '1246000' });
  });

  it('una fecha imposible devuelve el mensaje del servicio', async () => {
    const { cardId } = await setup();
    expect(await s.cards.paymentShortcuts(cardId, '2026-04-16')).toEqual({ ok: false, error: 'La fecha del pago no puede ser futura.' });
  });
});

describe('desglose para la pantalla', () => {
  it('pago exacto: nada pendiente, sin plata de más', async () => {
    const { cardId } = await setup();
    const result = await s.cards.previewCardPayment(cardId, pay({ amount: '124000' }));
    expect(result.ok && result.preview).toMatchObject({ pending: '0', needsMode: false, extraPurchaseId: null, extraTargets: [] });
  });

  it('pago parcial con algo vencido: dice cuánto queda pendiente', async () => {
    const { cardId } = await setup();
    now = MAY_10;
    const result = await s.cards.previewCardPayment(cardId, pay({ amount: '100000', paidOn: '2026-05-10' }));
    expect(result.ok && result.preview.pending).toBe('24000');
  });

  it('plata de más: la compra sugerida, las que pueden recibirla y la fecha final de cada opción', async () => {
    const { cardId, purchaseId } = await setup();
    const sofaId = await addSofa(cardId);
    const result = await s.cards.previewCardPayment(cardId, pay({ amount: '624000' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { preview } = result;
    expect(preview.extraPurchaseId).toBe(purchaseId);
    expect(preview.extraTargets).toEqual([
      { purchaseId, description: 'Nevera' },
      { purchaseId: sofaId, description: 'Sofá' },
    ]);
    expect(preview.outcomes[0]).toMatchObject({ purchaseId, SHORTEN: { endDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }, LOWER: { endDate: '2027-03-15' } });
    expect(preview.signature).toEqual(expect.any(String));
  });

  it('elegir otra compra cambia el destino de la plata de más', async () => {
    const { cardId } = await setup();
    const sofaId = await addSofa(cardId);
    const result = await s.cards.previewCardPayment(cardId, pay({ amount: '624000', extraPurchaseId: sofaId }));
    expect(result.ok && result.preview.extraPurchaseId).toBe(sofaId);
    expect(result.ok && result.preview.outcomes.map((o) => o.purchaseId)).toEqual([sofaId]);
  });
});

describe('lo confirmado es lo mostrado', () => {
  it('con la firma del desglose se guarda; si la tarjeta cambió entre medias, se rechaza sin escribir', async () => {
    const { cardId } = await setup();
    const shown = await s.cards.previewCardPayment(cardId, pay({ amount: '624000' }));
    if (!shown.ok) throw new Error(shown.error);
    await addSofa(cardId);
    expect(await s.cards.payCard(cardId, { ...pay({ amount: '624000', mode: 'SHORTEN' }), paymentId: 'pago-1', expected: shown.preview.signature })).toEqual({ ok: false, error: CARD_CHANGED });
    expect(await db.getAll('cardPayments')).toEqual([]);

    const again = await s.cards.previewCardPayment(cardId, pay({ amount: '624000' }));
    if (!again.ok) throw new Error(again.error);
    expect(await s.cards.payCard(cardId, { ...pay({ amount: '624000', mode: 'SHORTEN' }), paymentId: 'pago-1', expected: again.preview.signature })).toEqual({ ok: true });
  });
});

describe('la lista con pagos nuevos', () => {
  it('sin pagos nuevos: nada vencido, sin último pago, las cuotas como antes', async () => {
    await setup();
    const card = await cardView();
    expect(card.overdue).toBe('0');
    expect(card.lastCardPayment).toBeNull();
    expect(card.purchases[0]).toMatchObject({ paidCount: 0, installmentCount: 12, next: { number: 1, dueDate: '2026-04-15', total: '124000' } });
  });

  it('lo vencido se suma al día de hoy', async () => {
    await setup();
    now = MAY_10;
    expect((await cardView()).overdue).toBe('124000');
  });

  it('un pago parcial deja la próxima cuota con lo que falta y guarda el último pago', async () => {
    const { cardId } = await setup();
    expect(await s.cards.payCard(cardId, { ...pay(), paymentId: 'pago-1' })).toEqual({ ok: true });
    const card = await cardView();
    expect(card.lastCardPayment).toEqual({ id: 'pago-1', total: '50000', paidOn: '2026-04-15' });
    expect(card.purchases[0]!.next).toEqual({ number: 1, dueDate: '2026-04-15', capital: '74000', interest: '0', total: '74000' });
    expect(card.next).toEqual({ amount: '74000', date: '2026-04-15' });
  });

  it('terminar antes reduce las cuotas que se ven', async () => {
    const { cardId } = await setup();
    expect(await s.cards.payCard(cardId, { ...pay({ amount: '324000', mode: 'SHORTEN' }), paymentId: 'pago-1' })).toEqual({ ok: true });
    expect((await cardView()).purchases[0]).toMatchObject({ paidCount: 1, installmentCount: 10 });
  });
});

describe('manejo pagado con «Pagar tarjeta»', () => {
  it('un manejo pagado del todo deja de estar pendiente; uno pagado en parte muestra lo que falta', async () => {
    const { cardId } = await setup({ feeKind: 'FIXED_MONTHLY', feeAmount: '18000' });
    const before = (await cardView()).pendingFees;
    expect(before[0]).toMatchObject({ month: '2026-03', amount: '18000' });
    // En la misma fecha el manejo va primero: 10.000 quedan en él.
    expect(await s.cards.payCard(cardId, { ...pay({ amount: '10000' }), paymentId: 'pago-1' })).toEqual({ ok: true });
    expect((await cardView()).pendingFees[0]).toMatchObject({ month: '2026-03', amount: '8000' });
    expect(await s.cards.payCard(cardId, { ...pay({ amount: '8000' }), paymentId: 'pago-2' })).toEqual({ ok: true });
    expect((await cardView()).pendingFees.map((f) => f.month)).not.toContain('2026-03');
  });
});

describe('lo que queda por pagar después del pago', () => {
  it('A: debe 124.000 que vencen el 15 y paga 50.000 el 10: faltan 74.000 que vencen el 15', async () => {
    const { cardId } = await setup();
    now = APRIL_10;
    const result = await s.cards.previewCardPayment(cardId, pay({ amount: '50000', paidOn: '2026-04-10' }));
    expect(result.ok && { pending: result.preview.pending, dueSoon: result.preview.dueSoon }).toEqual({ pending: '0', dueSoon: { amount: '74000', dueDate: '2026-04-15' } });
  });

  it('B: 124.000 vencidos y 122.000 que vencen el 15; paga 100.000: quedan 24.000 vencidos y faltan 122.000', async () => {
    const { cardId } = await setup();
    now = MAY_10;
    const result = await s.cards.previewCardPayment(cardId, pay({ amount: '100000', paidOn: '2026-05-10' }));
    expect(result.ok && { pending: result.preview.pending, dueSoon: result.preview.dueSoon }).toEqual({ pending: '24000', dueSoon: { amount: '122000', dueDate: '2026-05-15' } });
  });

  it('pago exacto: no queda nada', async () => {
    const { cardId } = await setup();
    const result = await s.cards.previewCardPayment(cardId, pay({ amount: '124000' }));
    expect(result.ok && { pending: result.preview.pending, dueSoon: result.preview.dueSoon }).toEqual({ pending: '0', dueSoon: null });
  });

  it('marca la compra que queda pagada', async () => {
    const { cardId } = await setup();
    const result = await s.cards.previewCardPayment(cardId, pay({ amount: '1224000' }));
    expect(result.ok && result.preview.purchases.map((p) => p.paidOff)).toEqual([true]);
    const partial = await s.cards.previewCardPayment(cardId, pay({ amount: '124000' }));
    expect(partial.ok && partial.preview.purchases.map((p) => p.paidOff)).toEqual([false]);
  });
});

describe('el mismo pago con otros valores', () => {
  it('repetir el pago con la misma firma no hace nada más; con otra firma o monto avisa sin guardar', async () => {
    const { cardId } = await setup();
    const shown = await s.cards.previewCardPayment(cardId, pay({ amount: '124000' }));
    if (!shown.ok) throw new Error(shown.error);
    const first = { ...pay({ amount: '124000' }), paymentId: 'pago-1', expected: shown.preview.signature };
    expect(await s.cards.payCard(cardId, first)).toEqual({ ok: true });
    expect(await s.cards.payCard(cardId, first)).toEqual({ ok: true });
    expect(await s.cards.payCard(cardId, { ...first, amount: '100000', expected: 'otra' })).toEqual({ ok: false, error: OTHER_VALUES });
    expect(await s.cards.payCard(cardId, { ...first, amount: '100000', expected: undefined })).toEqual({ ok: false, error: OTHER_VALUES });
    expect(await db.count('cardPayments')).toBe(1);
  });
});

describe('borrar una compra que recibió plata de un pago nuevo', () => {
  it('la deuda, lo vencido y los atajos se calculan sin fallar, y deshacer el pago devuelve los saldos', async () => {
    const { cardId, purchaseId } = await setup();
    await addSofa(cardId);
    const balance = async () => (await s.summary.projection('2026-04-15')).netWorth.amount;
    const start = await balance();
    expect(await s.cards.payCard(cardId, { ...pay({ amount: '624000', mode: 'SHORTEN' }), paymentId: 'pago-1' })).toEqual({ ok: true });
    expect(await s.cards.removePurchase(purchaseId)).toEqual({ ok: true });

    const card = await cardView();
    expect(card.purchases.map((p) => p.description)).toEqual(['Sofá']);
    expect(card.overdue).toBe('0');
    expect((await s.cards.debtSummary()).debt).toBe('500000');
    expect((await s.cards.paymentShortcuts(cardId, '2026-04-15')).ok).toBe(true);

    expect(await s.cards.undoLastCardPayment(cardId, { paymentId: 'pago-1' })).toEqual({ ok: true });
    expect(await balance()).toBe(start);
    expect((await s.cards.debtSummary()).debt).toBe('600000');
    expect((await cardView()).lastCardPayment).toBeNull();
  });
});
