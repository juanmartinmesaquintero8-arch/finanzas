import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openFinanzasDb, type FinanzasDb } from '@/data/database';
import { IdbLedgerStore } from '@/data/idb-ledger-store';
import { previewPurchase } from './card-service';
import { createServices, type AppServices } from './create-services';
import { INT64_MAX } from './limits';

let dbName = '';
let db: FinanzasDb;
let s: AppServices;
let seq = 0;
let accountId = '';
let otherAccountId = '';
let now = new Date('2026-03-10T15:00:00Z');

beforeEach(async () => {
  now = new Date('2026-03-10T15:00:00Z');
  dbName = `cards-svc-${Math.random()}`;
  db = await openFinanzasDb(dbName);
  seq = 0;
  s = createServices({ db, now: () => now, newId: () => `id-${++seq}` });
  await s.accounts.create({ name: 'Banco', type: 'BANK', initialBalance: '10000000' });
  await s.accounts.create({ name: 'Nu', type: 'DIGITAL', initialBalance: '500000' });
  const accounts = await s.accounts.list();
  accountId = accounts[0]!.id;
  otherAccountId = accounts[1]!.id;
});
afterEach(async () => {
  db.close();
  await deleteDB(dbName);
});

const cardInput = (over = {}) => ({
  name: 'Visa Bancolombia',
  dueDay: 15,
  paymentAccountId: accountId,
  feeKind: 'NONE' as const,
  ...over,
});
const withInterest = (over = {}) => cardInput({ rateBasis: 'MV' as const, rateText: '2', ...over });

const purchaseInput = (cardId: string, over = {}) => ({
  cardId,
  description: 'Nevera',
  amount: '1200000',
  installments: 12,
  purchaseDate: '2026-03-02',
  firstDueDate: '2026-04-15',
  category: 'Hogar',
  ...over,
});

async function newCard(over = {}) {
  expect(await s.cards.createCard(withInterest(over))).toEqual({ ok: true });
  const cards = await s.cards.list();
  return cards[cards.length - 1]!;
}
async function newPurchase(cardId: string, over = {}) {
  expect(await s.cards.addPurchase(purchaseInput(cardId, over))).toEqual({ ok: true });
  const purchases = await db.getAll('cardPurchases');
  return purchases[purchases.length - 1]!;
}
const purchaseRow = (id: string) => db.get('cardPurchases', id);
const movements = async () => (await db.getAll('transactions')).map((t) => t.id).sort();
const pay = (over = {}) => ({ fromAccountId: accountId, paidOn: '2026-04-15', ...over });

describe('tarjetas: crear, editar, borrar y límites', () => {
  it('crea con manejo y tasa, y lista lo básico', async () => {
    expect(await s.cards.createCard(cardInput({ feeKind: 'FIXED_MONTHLY', feeAmount: '18000', rateBasis: 'EA', rateText: '26,82' }))).toEqual({ ok: true });
    const [card] = await s.cards.list();
    expect(card).toMatchObject({
      name: 'Visa Bancolombia', dueDay: 15, paymentAccountId: accountId, feeKind: 'FIXED_MONTHLY', feeAmount: '18000', rateBasis: 'EA', rateText: '26,82',
      monthlyRatePpm: 19_997, chargesInterest: true, debt: '0', next: null, purchases: [],
    });
    expect((await db.getAll('creditCards'))[0]!.feeStartMonth).toBe('2026-03');
  });

  it('sin intereses no guarda tasa', async () => {
    await s.cards.createCard(cardInput());
    expect((await s.cards.list())[0]).toMatchObject({ chargesInterest: false, rateBasis: null, monthlyRatePpm: 0 });
  });

  it('valida nombre, día, cuenta, monto del manejo y límites', async () => {
    const before = await db.count('creditCards');
    expect(await s.cards.createCard(cardInput({ name: '  ' }))).toEqual({ ok: false, error: 'El nombre de la tarjeta es obligatorio' });
    expect(await s.cards.createCard(cardInput({ dueDay: 32 }))).toMatchObject({ ok: false });
    expect(await s.cards.createCard(cardInput({ paymentAccountId: 'fantasma' }))).toMatchObject({ ok: false });
    expect(await s.cards.createCard(cardInput({ feeKind: 'FIXED_MONTHLY' }))).toMatchObject({ ok: false });
    expect(await s.cards.createCard(cardInput({ name: 'x'.repeat(81) }))).toEqual({ ok: false, error: 'El nombre no puede superar 80 caracteres.' });
    expect(await s.cards.createCard(cardInput({ feeKind: 'ON_MOVEMENT', feeAmount: (INT64_MAX + 1n).toString() }))).toEqual({ ok: false, error: 'El monto es demasiado grande.' });
    expect(await db.count('creditCards')).toBe(before);
  });

  it('no permite pasar de 100 tarjetas (la copia no se podría recuperar)', async () => {
    for (let i = 0; i < 100; i++) expect(await s.cards.createCard(cardInput({ name: `T${i}` }))).toEqual({ ok: true });
    expect(await s.cards.createCard(cardInput())).toEqual({ ok: false, error: 'Llegaste al máximo de 100 tarjetas.' });
  });

  it('cambiar la tasa no toca las compras ya guardadas', async () => {
    const card = await newCard();
    const p = await newPurchase(card.id);
    expect(p.monthlyRatePpm).toBe(20_000);
    expect(await s.cards.updateCard(card.id, withInterest({ rateText: '3' }))).toEqual({ ok: true });
    expect((await purchaseRow(p.id))!.monthlyRatePpm).toBe(20_000);
    expect((await s.cards.list())[0]!.monthlyRatePpm).toBe(30_000);
  });

  it('activar un manejo después de crearla no cobra los meses de atrás', async () => {
    await s.cards.createCard(cardInput());
    const [card] = await s.cards.list();
    now = new Date('2026-08-10T15:00:00Z');
    await s.cards.updateCard(card!.id, cardInput({ feeKind: 'FIXED_MONTHLY', feeAmount: '18000' }));
    const [after] = await s.cards.list();
    expect(after!.pendingFees.map((f) => f.month)).toEqual(['2026-08']);
    expect((await db.getAll('creditCards'))[0]!.feeStartMonth).toBe('2026-08');
  });

  it('borra la tarjeta y sus compras, y conserva los pagos reales', async () => {
    const card = await newCard();
    const p = await newPurchase(card.id);
    await s.cards.payInstallment(p.id, pay());
    expect(await s.cards.removeCard(card.id)).toEqual({ ok: true });
    expect(await db.count('creditCards')).toBe(0);
    expect(await db.count('cardPurchases')).toBe(0);
    expect(await movements()).toEqual([`ci-${p.id}-1`, `cp-${p.id}-1`]);
    expect(await s.cards.removeCard('nope')).toMatchObject({ ok: false });
  });
});

describe('compras: agregar y previsualizar', () => {
  it('vista previa exacta del control del diseño, y es pura', async () => {
    const card = await newCard();
    const result = previewPurchase(card, purchaseInput(card.id));
    if (!result.ok) throw new Error(result.error);
    expect(result.preview).toMatchObject({ totalCount: 12, remainingCount: 12, totalInterest: '156000', totalToPay: '1356000' });
    expect(result.preview.installments.slice(0, 2)).toEqual([
      { number: 1, dueDate: '2026-04-15', capital: '100000', interest: '24000', total: '124000' },
      { number: 2, dueDate: '2026-05-15', capital: '100000', interest: '22000', total: '122000' },
    ]);
    expect(result.preview.installments[11]).toMatchObject({ number: 12, dueDate: '2027-03-15', total: '102000' });
    expect(await db.count('cardPurchases')).toBe(0);
  });

  it('con cuotas ya pagadas la vista previa muestra solo lo que falta', async () => {
    const card = await newCard();
    const result = previewPurchase(card, purchaseInput(card.id, { paidInstallments: 10 }));
    if (!result.ok) throw new Error(result.error);
    expect(result.preview).toMatchObject({ totalCount: 12, remainingCount: 2, totalInterest: '6000', totalToPay: '206000' });
    expect(result.preview.installments.map((i) => i.number)).toEqual([11, 12]);
  });

  it('copia la tasa de la tarjeta; sin intereses si el interruptor está activo o la tarjeta no cobra', async () => {
    const card = await newCard();
    expect((await newPurchase(card.id)).monthlyRatePpm).toBe(20_000);
    expect((await newPurchase(card.id, { withoutInterest: true })).monthlyRatePpm).toBe(0);
    await s.cards.createCard(cardInput({ name: 'Sin' }));
    const free = (await s.cards.list()).find((c) => c.name === 'Sin')!;
    expect((await newPurchase(free.id)).monthlyRatePpm).toBe(0);
  });

  it('el ancla es el día de pago si la primera fecha es la sugerida; vacía si la cambió', async () => {
    const card = await newCard({ dueDay: 31 });
    const suggested = await newPurchase(card.id, { purchaseDate: '2026-01-20', firstDueDate: '2026-02-28' });
    expect(suggested.dueDayAnchor).toBe(31);
    const changed = await newPurchase(card.id, { purchaseDate: '2026-01-20', firstDueDate: '2026-03-02' });
    expect(changed.dueDayAnchor).toBeNull();
  });

  it('sugerencia de primera cuota: el día de pago del mes siguiente, recortado', async () => {
    const card = await newCard({ dueDay: 31 });
    expect(s.cards.suggestFirstDueDate(card, '2026-01-20')).toBe('2026-02-28');
    expect(s.cards.suggestFirstDueDate(card, '')).toBeNull();
  });

  it('valida textos, montos, tarjeta y cuotas; y rechaza si un total superaría int64', async () => {
    const card = await newCard();
    const huge = (INT64_MAX - 1n).toString();
    const bad: [object, string][] = [
      [{ description: 'x'.repeat(161) }, 'La descripción no puede superar 160 caracteres.'],
      [{ category: 'x'.repeat(61) }, 'La categoría no puede superar 60 caracteres.'],
      [{ amount: (INT64_MAX + 1n).toString() }, 'El monto es demasiado grande.'],
      [{ amount: huge, installments: 6 }, 'El monto es demasiado grande.'],
      [{ amount: '0' }, 'El monto de la compra debe ser mayor que cero'],
      [{ installments: 73 }, 'Las cuotas deben ser un entero entre 1 y 72'],
      [{ paidInstallments: 13 }, 'Las cuotas pagadas deben ir de 0 al total de cuotas'],
      [{ firstDueDate: '2026-02-01' }, 'La primera cuota no puede ser anterior a la compra'],
      [{ purchaseDate: '1999-01-01', firstDueDate: '2026-04-15' }, 'La fecha debe estar entre el año 2000 y el 2100.'],
    ];
    for (const [over, error] of bad) expect(await s.cards.addPurchase(purchaseInput(card.id, over))).toEqual({ ok: false, error });
    expect(await s.cards.addPurchase(purchaseInput('nope'))).toMatchObject({ ok: false });
    expect(await db.count('cardPurchases')).toBe(0);
  });

  it('una compra sin interés acepta el mayor monto posible', async () => {
    const card = await newCard();
    expect(await s.cards.addPurchase(purchaseInput(card.id, { amount: INT64_MAX.toString(), withoutInterest: true }))).toEqual({ ok: true });
  });

  it('una compra antigua con cuotas ya pagadas no crea movimientos', async () => {
    const card = await newCard();
    const p = await newPurchase(card.id, { paidInstallments: 3 });
    expect(p.paidInstallments).toBe(3);
    expect(await movements()).toEqual([]);
    const [view] = await s.cards.list();
    expect(view!.purchases[0]).toMatchObject({ paidInstallments: 3, next: { number: 4 } });
    expect(view!.debt).toBe('900000');
  });
});

describe('compras: editar y borrar', () => {
  it('sin cuotas pagadas se edita todo y conserva tasa y ancla de lo ya pactado', async () => {
    const card = await newCard({ dueDay: 31 });
    const p = await newPurchase(card.id, { purchaseDate: '2026-01-20', firstDueDate: '2026-02-28' });
    await s.cards.updateCard(card.id, withInterest({ dueDay: 10, rateText: '3' }));
    expect(await s.cards.updatePurchase(p.id, purchaseInput(card.id, { description: 'Nevera grande', amount: '600000', purchaseDate: '2026-01-20', firstDueDate: '2026-02-28' }))).toEqual({ ok: true });
    expect(await purchaseRow(p.id)).toMatchObject({ description: 'Nevera grande', amount: '600000', monthlyRatePpm: 20_000, dueDayAnchor: 31 });
  });

  it('con cuotas pagadas solo cambian descripción y categoría', async () => {
    const card = await newCard();
    const p = await newPurchase(card.id);
    await s.cards.payInstallment(p.id, pay());
    expect(await s.cards.updatePurchase(p.id, purchaseInput(card.id, { description: 'Otra', category: 'Casa' }))).toEqual({ ok: true });
    expect(await purchaseRow(p.id)).toMatchObject({ description: 'Otra', category: 'Casa', paidInstallments: 1 });
    expect(await s.cards.updatePurchase(p.id, purchaseInput(card.id, { amount: '1' }))).toEqual({
      ok: false,
      error: 'Esta compra ya tiene cuotas pagadas: solo puedes cambiar la descripción y la categoría.',
    });
    expect((await purchaseRow(p.id))!.amount).toBe('1200000');
  });

  it('borrar conserva los pagos y quita la deuda', async () => {
    const card = await newCard();
    const p = await newPurchase(card.id);
    await s.cards.payInstallment(p.id, pay());
    expect(await s.cards.removePurchase(p.id)).toEqual({ ok: true });
    expect((await s.cards.list())[0]!.debt).toBe('0');
    expect((await s.cards.debtSummary()).debt).toBe('0');
    expect(await movements()).toEqual([`ci-${p.id}-1`, `cp-${p.id}-1`]);
    expect(await s.cards.removePurchase('nope')).toMatchObject({ ok: false });
  });
});

describe('payInstallment', () => {
  it('crea capital e interés con categorías e ids fijos, con el día real de pago', async () => {
    const card = await newCard();
    const p = await newPurchase(card.id);
    expect(await s.cards.payInstallment(p.id, pay({ paidOn: '2026-04-20' }))).toEqual({ ok: true });
    const capital = await db.get('transactions', `cp-${p.id}-1`);
    const interest = await db.get('transactions', `ci-${p.id}-1`);
    expect(capital).toMatchObject({ type: 'EXPENSE', amount: '100000', category: 'Hogar', accountId, date: '2026-04-20T00:00:00.000Z', description: 'Nevera (cuota 1/12)' });
    expect(interest).toMatchObject({ type: 'EXPENSE', amount: '24000', category: 'Intereses y manejo', accountId, date: '2026-04-20T00:00:00.000Z', description: 'Intereses Nevera (cuota 1/12)' });
    expect((await purchaseRow(p.id))!.paidInstallments).toBe(1);
  });

  it('un pago desde otra cuenta sale de esa cuenta', async () => {
    const card = await newCard();
    const p = await newPurchase(card.id);
    await s.cards.payInstallment(p.id, pay({ fromAccountId: otherAccountId }));
    expect((await db.get('transactions', `cp-${p.id}-1`))!.accountId).toBe(otherAccountId);
  });

  it('interés 0 crea un solo gasto', async () => {
    const card = await newCard();
    const p = await newPurchase(card.id, { withoutInterest: true });
    await s.cards.payInstallment(p.id, pay());
    expect(await movements()).toEqual([`cp-${p.id}-1`]);
    const q = await newPurchase(card.id);
    await s.cards.payInstallment(q.id, pay({ interest: '0' }));
    expect(await db.get('transactions', `ci-${q.id}-1`)).toBeUndefined();
    expect(await db.get('transactions', `cp-${q.id}-1`)).toBeDefined();
  });

  it('el interés se ajusta al extracto sin alterar el plan', async () => {
    const card = await newCard();
    const p = await newPurchase(card.id);
    await s.cards.payInstallment(p.id, pay({ interest: '25000' }));
    expect((await db.get('transactions', `ci-${p.id}-1`))!.amount).toBe('25000');
    expect((await s.cards.list())[0]!.purchases[0]!.next).toMatchObject({ number: 2, interest: '22000' });
  });

  it('rechaza un interés negativo o inválido', async () => {
    const card = await newCard();
    const p = await newPurchase(card.id);
    expect(await s.cards.payInstallment(p.id, pay({ interest: '-1' }))).toEqual({ ok: false, error: 'El interés no puede ser negativo.' });
    expect(await s.cards.payInstallment(p.id, pay({ interest: 'abc' }))).toMatchObject({ ok: false });
    expect(await movements()).toEqual([]);
  });

  it('siempre en orden: la segunda llamada paga la siguiente cuota', async () => {
    const card = await newCard();
    const p = await newPurchase(card.id);
    await s.cards.payInstallment(p.id, pay());
    await s.cards.payInstallment(p.id, pay({ paidOn: '2026-05-15' }));
    expect(await movements()).toEqual([`ci-${p.id}-1`, `ci-${p.id}-2`, `cp-${p.id}-1`, `cp-${p.id}-2`]);
    expect((await purchaseRow(p.id))!.paidInstallments).toBe(2);
  });

  it('doble toque simultáneo no duplica', async () => {
    const card = await newCard();
    const p = await newPurchase(card.id);
    const results = await Promise.all([s.cards.payInstallment(p.id, pay()), s.cards.payInstallment(p.id, pay())]);
    expect(results).toEqual([{ ok: true }, { ok: true }]);
    expect(await movements()).toEqual([`ci-${p.id}-1`, `cp-${p.id}-1`]);
    expect((await purchaseRow(p.id))!.paidInstallments).toBe(1);
  });

  it('un segundo toque de la misma cuota, ya pagada, no paga la siguiente', async () => {
    const card = await newCard();
    const p = await newPurchase(card.id);
    await s.cards.payInstallment(p.id, pay({ installment: 1 }));
    expect(await s.cards.payInstallment(p.id, pay({ installment: 1 }))).toEqual({ ok: true });
    expect(await movements()).toEqual([`ci-${p.id}-1`, `cp-${p.id}-1`]);
    expect((await purchaseRow(p.id))!.paidInstallments).toBe(1);
    expect(await s.cards.payInstallment(p.id, pay({ installment: 3 }))).toEqual({ ok: false, error: 'Esa cuota todavía no es la siguiente. Revisa la lista.' });
  });

  it('si la escritura falla no se marca nada ni avisa como exitoso', async () => {
    const card = await newCard();
    const p = await newPurchase(card.id);
    const spy = vi.spyOn(IdbLedgerStore.prototype, 'writeCardPayment').mockRejectedValueOnce(new Error('disco'));
    expect(await s.cards.payInstallment(p.id, pay())).toMatchObject({ ok: false });
    spy.mockRestore();
    expect(await movements()).toEqual([]);
    expect((await purchaseRow(p.id))!.paidInstallments).toBe(0);
  });

  it('cuota de capital 0 (monto menor que las cuotas) no crea gasto de capital', async () => {
    const card = await newCard();
    const p = await newPurchase(card.id, { amount: '5', installments: 12, withoutInterest: true });
    await s.cards.payInstallment(p.id, pay());
    await s.cards.payInstallment(p.id, pay());
    expect(await movements()).toEqual([`cp-${p.id}-1`]);
    expect((await purchaseRow(p.id))!.paidInstallments).toBe(2);
  });

  it('una descripción enorme traída de una copia no produce un movimiento imposible de recuperar', async () => {
    const card = await newCard();
    const p = await newPurchase(card.id);
    await db.put('cardPurchases', { ...p, description: 'x'.repeat(2000) });
    await s.cards.payInstallment(p.id, pay());
    expect((await db.get('transactions', `cp-${p.id}-1`))!.description.length).toBeLessThanOrEqual(160);
    expect((await db.get('transactions', `ci-${p.id}-1`))!.description.length).toBeLessThanOrEqual(160);
  });

  it('no paga lo cerrado, lo ya pagado, ni desde una cuenta que no existe', async () => {
    const card = await newCard();
    const p = await newPurchase(card.id, { installments: 1 });
    expect(await s.cards.payInstallment(p.id, pay({ fromAccountId: 'nope' }))).toMatchObject({ ok: false });
    await s.cards.payInstallment(p.id, pay());
    expect(await s.cards.payInstallment(p.id, pay())).toEqual({ ok: false, error: 'Esta compra ya está pagada.' });
    expect(await s.cards.payInstallment('nope', pay())).toMatchObject({ ok: false });
    const q = await newPurchase(card.id);
    await s.cards.settle(q.id, pay());
    expect(await s.cards.payInstallment(q.id, pay())).toEqual({ ok: false, error: 'Esta compra ya está liquidada.' });
  });
});

describe('undoLastPayment', () => {
  it('borra los movimientos de la última cuota y resta una', async () => {
    const card = await newCard();
    const p = await newPurchase(card.id);
    await s.cards.payInstallment(p.id, pay());
    await s.cards.payInstallment(p.id, pay());
    expect(await s.cards.undoLastPayment(p.id)).toEqual({ ok: true });
    expect(await movements()).toEqual([`ci-${p.id}-1`, `cp-${p.id}-1`]);
    expect((await purchaseRow(p.id))!.paidInstallments).toBe(1);
  });

  it('un doble toque no deshace dos cuotas', async () => {
    const card = await newCard();
    const p = await newPurchase(card.id);
    await s.cards.payInstallment(p.id, pay());
    await s.cards.payInstallment(p.id, pay());
    await s.cards.undoLastPayment(p.id, { installment: 2 });
    expect(await s.cards.undoLastPayment(p.id, { installment: 2 })).toEqual({ ok: true });
    expect((await purchaseRow(p.id))!.paidInstallments).toBe(1);
  });

  it('sin pagos o con la compra liquidada no se puede', async () => {
    const card = await newCard();
    const p = await newPurchase(card.id);
    expect(await s.cards.undoLastPayment(p.id)).toEqual({ ok: false, error: 'Esta compra no tiene pagos para deshacer.' });
    await s.cards.payInstallment(p.id, pay());
    await s.cards.settle(p.id, pay());
    expect(await s.cards.undoLastPayment(p.id)).toEqual({ ok: false, error: 'Esta compra ya está liquidada, así que no se puede deshacer el pago.' });
    expect((await purchaseRow(p.id))!.paidInstallments).toBe(1);
  });
});

describe('settle', () => {
  it('paga capital restante más solo el interés de la próxima cuota y cierra', async () => {
    const card = await newCard();
    const p = await newPurchase(card.id);
    await s.cards.payInstallment(p.id, pay());
    expect(await s.cards.settle(p.id, pay({ paidOn: '2026-04-20' }))).toEqual({ ok: true });
    const capital = await db.get('transactions', `cp-${p.id}-liq`);
    const interest = await db.get('transactions', `ci-${p.id}-liq`);
    expect(capital).toMatchObject({ amount: '1100000', category: 'Hogar', accountId, date: '2026-04-20T00:00:00.000Z' });
    expect(interest).toMatchObject({ amount: '22000', category: 'Intereses y manejo' });
    const row = await purchaseRow(p.id);
    expect(row).toMatchObject({ closedOn: '2026-04-20T00:00:00.000Z', paidInstallments: 1 });
    expect((await s.cards.list())[0]!.debt).toBe('0');
  });

  it('doble toque no duplica; sin interés crea un solo gasto', async () => {
    const card = await newCard();
    const p = await newPurchase(card.id, { withoutInterest: true });
    await Promise.all([s.cards.settle(p.id, pay()), s.cards.settle(p.id, pay())]);
    expect(await movements()).toEqual([`cp-${p.id}-liq`]);
  });

  it('no liquida lo pagado o ya liquidado, ni con fecha anterior a la compra', async () => {
    const card = await newCard();
    const p = await newPurchase(card.id, { installments: 1 });
    await s.cards.payInstallment(p.id, pay());
    expect(await s.cards.settle(p.id, pay())).toEqual({ ok: false, error: 'Esta compra ya está pagada.' });
    const q = await newPurchase(card.id);
    await s.cards.settle(q.id, pay());
    expect(await s.cards.settle(q.id, pay())).toEqual({ ok: false, error: 'Esta compra ya está liquidada.' });
    const r = await newPurchase(card.id);
    expect(await s.cards.settle(r.id, pay({ paidOn: '2026-01-01' }))).toEqual({ ok: false, error: 'El cierre no puede ser anterior a la compra' });
  });
});

describe('payFee', () => {
  const feeCard = () => newCard({ feeKind: 'FIXED_MONTHLY', feeAmount: '18000' });

  it('crea el gasto en Intereses y manejo y marca el mes, atómico', async () => {
    const card = await feeCard();
    expect(await s.cards.payFee(card.id, '2026-03', pay())).toEqual({ ok: true });
    expect(await db.get('transactions', `cf-${card.id}-2026-03`)).toMatchObject({ amount: '18000', category: 'Intereses y manejo', accountId, date: '2026-04-15T00:00:00.000Z' });
    expect((await db.get('creditCards', card.id))!.feesSettledThrough).toBe('2026-03');
  });

  it('acepta un monto ajustado y rechaza uno inválido', async () => {
    const card = await feeCard();
    expect(await s.cards.payFee(card.id, '2026-03', pay({ amount: '0' }))).toEqual({ ok: false, error: 'El valor del manejo debe ser mayor que cero.' });
    await s.cards.payFee(card.id, '2026-03', pay({ amount: '20000' }));
    expect((await db.get('transactions', `cf-${card.id}-2026-03`))!.amount).toBe('20000');
  });

  it('se paga en orden; un mes ya pagado es un doble toque y no duplica', async () => {
    const card = await feeCard();
    now = new Date('2026-06-10T15:00:00Z');
    expect(await s.cards.payFee(card.id, '2026-04', pay())).toEqual({ ok: false, error: 'Paga primero la cuota de manejo de marzo.' });
    await s.cards.payFee(card.id, '2026-03', pay());
    expect(await s.cards.payFee(card.id, '2026-03', pay())).toEqual({ ok: true });
    expect(await db.count('transactions')).toBe(1);
    expect(await s.cards.payFee(card.id, 'mal', pay())).toMatchObject({ ok: false });
    await Promise.all([s.cards.payFee(card.id, '2026-04', pay()), s.cards.payFee(card.id, '2026-04', pay())]);
    expect(await db.count('transactions')).toBe(2);
    expect((await db.get('creditCards', card.id))!.feesSettledThrough).toBe('2026-04');
  });

  it('un mes que no se cobra no se puede pagar', async () => {
    const card = await newCard({ feeKind: 'ON_MOVEMENT', feeAmount: '18000' });
    expect(await s.cards.payFee(card.id, '2026-03', pay())).toEqual({ ok: false, error: 'Esa cuota de manejo no está pendiente.' });
  });

  it('con movimiento: una compra nueva hace aparecer la cuota del mes siguiente', async () => {
    const card = await newCard({ feeKind: 'ON_MOVEMENT', feeAmount: '18000' });
    expect((await s.cards.list())[0]!.pendingFees).toEqual([]);
    await newPurchase(card.id, { purchaseDate: '2026-03-02' });
    expect((await s.cards.list())[0]!.pendingFees).toEqual([{ month: '2026-03', dueDate: '2026-04-15', amount: '18000' }]);
  });
});

describe('vista de la lista', () => {
  it('deuda total, próxima cuota sumando las que caen el mismo día, y compras ordenadas', async () => {
    const card = await newCard();
    await newPurchase(card.id);
    await newPurchase(card.id, { description: 'Sofá', amount: '600000', installments: 6, withoutInterest: true });
    const [view] = await s.cards.list();
    expect(view!.debt).toBe('1800000');
    expect(view!.next).toEqual({ amount: '224000', date: '2026-04-15' });
    expect((await s.cards.debtSummary())).toEqual({ hasCards: true, debt: '1800000' });
  });

  it('sin tarjetas no hay deuda que mostrar', async () => {
    expect(await s.cards.debtSummary()).toEqual({ hasCards: false, debt: '0' });
  });
});

describe('reglas fuera del servicio', () => {
  it('TransactionService rechaza editar o borrar los pagos de tarjeta', async () => {
    const card = await newCard();
    const p = await newPurchase(card.id);
    await s.cards.payInstallment(p.id, pay());
    const error = 'Este pago viene de una tarjeta. Para deshacerlo, usa «Deshacer último pago» en la tarjeta.';
    const edit = { type: 'EXPENSE' as const, amount: '1', date: '2026-04-15', description: 'x', accountId };
    expect(await s.transactions.update(`cp-${p.id}-1`, edit)).toEqual({ ok: false, error });
    expect(await s.transactions.update(`ci-${p.id}-1`, edit)).toEqual({ ok: false, error });
    expect(await s.transactions.remove(`cp-${p.id}-1`)).toEqual({ ok: false, error });
    expect(await s.transactions.remove('cf-x-2026-03')).toEqual({ ok: false, error: 'No encontramos ese movimiento.' });
    expect(await s.cards.undoLastPayment(p.id)).toEqual({ ok: true });
  });

  it('una cuenta usada como cuenta de pago no se puede borrar', async () => {
    await newCard({ paymentAccountId: otherAccountId });
    expect(await s.accounts.remove(otherAccountId)).toEqual({ ok: false, error: 'Esta cuenta paga una tarjeta de crédito. Cámbiala o borra la tarjeta primero.' });
  });
});

describe('Saldo Real', () => {
  it('resta lo que vence hasta la fecha, vencidas incluidas; pagar saca la cuota; la deuda total no se resta', async () => {
    const card = await newCard();
    const p = await newPurchase(card.id, { purchaseDate: '2026-01-02', firstDueDate: '2026-02-15', amount: '1200000', withoutInterest: true });
    const before = await s.summary.projection('2026-03-31');
    // Vencida 15 feb y la del 15 mar: dos de 100.000.
    expect(before.committed.amount).toBe('200000');
    expect(before.availableBalance.amount).toBe('10300000');
    expect(before.commitments.map((c) => [c.date, c.amount.amount])).toEqual([
      ['2026-03-10', '100000'],
      ['2026-03-15', '100000'],
    ]);
    const paidOn = { fromAccountId: accountId, paidOn: '2026-03-10' };
    await s.cards.payInstallment(p.id, paidOn);
    const after = await s.summary.projection('2026-03-31');
    expect(after.committed.amount).toBe('100000');
    expect(after.netWorth.amount).toBe('10400000');
    expect(after.availableBalance.amount).toBe('10300000');
    expect((await s.cards.debtSummary()).debt).toBe('1100000');
  });

  it('el manejo pendiente también se resta', async () => {
    await newCard({ feeKind: 'FIXED_MONTHLY', feeAmount: '18000' });
    expect((await s.summary.projection('2026-04-30')).committed.amount).toBe('18000');
    expect((await s.summary.projection('2026-03-31')).committed.amount).toBe('0');
  });
});

describe('copia de seguridad con los movimientos de la tarjeta', () => {
  it('una compra y su pago se pueden recuperar', async () => {
    const card = await newCard({ dueDay: 31, feeKind: 'FIXED_MONTHLY', feeAmount: '18000' });
    const p = await newPurchase(card.id, { purchaseDate: '2026-01-20', firstDueDate: '2026-02-28' });
    await s.cards.payInstallment(p.id, pay());
    await s.cards.payFee(card.id, '2026-03', pay());
    const { problem, text } = await s.backup.create();
    expect(problem).toBeNull();
    expect(JSON.parse(text).cardPurchases[0].dueDayAnchor).toBe(31);
  });
});
