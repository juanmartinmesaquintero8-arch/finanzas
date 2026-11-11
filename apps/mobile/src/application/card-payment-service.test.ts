import { cardCommitments, startOfDayUTC } from '@finanzas/domain';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openFinanzasDb, type FinanzasDb } from '@/data/database';
import { IdbCardPaymentRepository } from '@/data/idb-card.repository';
import { createServices, type AppServices } from './create-services';
import { SAMPLE_PREFIX } from './sample-data';

let dbName = '';
let db: FinanzasDb;
let s: AppServices;
let seq = 0;
let accountId = '';
let now = new Date('2026-03-10T15:00:00Z');

/** 15 de abril a las 8 p. m. en Colombia: en UTC ya es 16 de abril. */
const APRIL_15_8PM = new Date('2026-04-16T01:00:00Z');

const LEGACY = 'Esta tarjeta ya usa el pago único. Para corregir, usa «Deshacer último pago de la tarjeta».';
const IN_PAYMENT = 'Este pago es parte de un pago de tarjeta. Para deshacerlo, usa «Deshacer último pago de la tarjeta».';
const INTEREST = 'Intereses y manejo';

beforeEach(async () => {
  now = new Date('2026-03-10T15:00:00Z');
  dbName = `card-pay-${Math.random()}`;
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

/** Tarjeta con 2 % MV, día de pago 15; la compra «Nevera» de 1.200.000 a 12 cuotas: la 1 vale 100.000 + 24.000 el 15 de abril. */
async function setup(over: Record<string, unknown> = {}) {
  expect(await s.cards.createCard({ name: 'Visa', dueDay: 15, paymentAccountId: accountId, feeKind: 'NONE', rateBasis: 'MV', rateText: '2', ...over })).toEqual({ ok: true });
  const cardId = (await s.cards.list())[0]!.id;
  expect(
    await s.cards.addPurchase({ cardId, description: 'Nevera', amount: '1200000', installments: 12, purchaseDate: '2026-03-02', firstDueDate: '2026-04-15', category: 'Hogar' }),
  ).toEqual({ ok: true });
  const purchaseId = (await db.getAll('cardPurchases'))[0]!.id;
  now = APRIL_15_8PM;
  return { cardId, purchaseId };
}

const input = (over: Record<string, unknown> = {}) => ({ paymentId: 'pago-1', amount: '50000', paidOn: '2026-04-15', fromAccountId: accountId, ...over });
const movements = async () =>
  (await db.getAll('transactions'))
    .filter((t) => t.id.startsWith('pt-'))
    .map((t) => ({ id: t.id, amount: t.amount, category: t.category, description: t.description, accountId: t.accountId, date: t.date }));
const balance = async () => (await s.summary.projection('2026-04-15')).netWorth.amount;
const state = async () => ({
  projection: await s.summary.projection('2026-12-31'),
  debt: await s.cards.debtSummary(),
  rows: (await db.getAll('transactions')).map((t) => t.id).sort(),
});

describe('payCard: reparte un pago y lo guarda en una sola escritura', () => {
  it('pago parcial: primero el interés, luego el capital; movimientos con ids, categorías y descripciones', async () => {
    const { cardId } = await setup();
    expect(await s.cards.payCard(cardId, input())).toEqual({ ok: true });
    expect(await movements()).toEqual([
      { id: 'pt-pago-1-01', amount: '26000', category: 'Hogar', description: 'Nevera (pago de tarjeta)', accountId, date: '2026-04-15T00:00:00.000Z' },
      { id: 'pt-pago-1-02', amount: '24000', category: INTEREST, description: 'Intereses Nevera', accountId, date: '2026-04-15T00:00:00.000Z' },
    ]);
    const [event] = await new IdbCardPaymentRepository(db).findByCard(cardId);
    expect(event).toMatchObject({ id: 'pago-1', cardId, seq: 1, fromAccountId: accountId, transactionIds: ['pt-pago-1-01', 'pt-pago-1-02'] });
    expect(event!.total.amount).toBe(50_000n);
    expect(event!.extraMode).toBeUndefined();
  });

  it('pago exacto de la cuota', async () => {
    const { cardId } = await setup();
    expect(await s.cards.payCard(cardId, input({ amount: '124000' }))).toEqual({ ok: true });
    expect((await movements()).map((m) => [m.id, m.amount])).toEqual([['pt-pago-1-01', '100000'], ['pt-pago-1-02', '24000']]);
    expect((await s.cards.debtSummary()).debt).toBe('1100000');
  });

  it('los movimientos de valor cero no se crean', async () => {
    const { cardId } = await setup();
    expect(await s.cards.payCard(cardId, input({ amount: '24000' }))).toEqual({ ok: true });
    expect((await movements()).map((m) => [m.id, m.amount, m.description])).toEqual([['pt-pago-1-01', '24000', 'Intereses Nevera']]);
  });

  it('plata de más terminando antes: un solo capital por compra y quedan menos cuotas', async () => {
    const { cardId, purchaseId } = await setup();
    expect(await s.cards.payCard(cardId, input({ amount: '324000', mode: 'SHORTEN' }))).toEqual({ ok: true });
    expect((await movements()).map((m) => [m.id, m.amount, m.category])).toEqual([['pt-pago-1-01', '300000', 'Hogar'], ['pt-pago-1-02', '24000', INTEREST]]);
    const [event] = await new IdbCardPaymentRepository(db).findByCard(cardId);
    expect(event!.extraMode).toBe('SHORTEN');
    expect((await s.cards.debtSummary()).debt).toBe('900000');
    const commitments = (await s.summary.projection('2027-12-31')).commitments.filter((c) => c.scheduledExpenseId === purchaseId);
    expect(commitments).toHaveLength(9);
    expect(commitments[0]!.description).toBe('Nevera (cuota 2/10)');
  });

  it('plata de más bajando la cuota: mismas cuotas, más baratas', async () => {
    const { cardId, purchaseId } = await setup();
    expect(await s.cards.payCard(cardId, input({ amount: '324000', mode: 'LOWER' }))).toEqual({ ok: true });
    const commitments = (await s.summary.projection('2027-12-31')).commitments.filter((c) => c.scheduledExpenseId === purchaseId);
    expect(commitments).toHaveLength(11);
    // 900.000 / 11 = 81.818 (las 2 primeras llevan 81.819) + interés sobre 900.000 al 2 %.
    expect(commitments[0]!.amount.amount).toBe(String(81_819 + 18_000));
  });

  it('con manejo: un movimiento por cada cuota de manejo pagada', async () => {
    const { cardId } = await setup({ feeKind: 'FIXED_MONTHLY', feeAmount: '18000' });
    expect(await s.cards.payCard(cardId, input({ amount: '142000' }))).toEqual({ ok: true });
    expect((await movements()).map((m) => [m.id, m.amount, m.category, m.description])).toEqual([
      ['pt-pago-1-01', '100000', 'Hogar', 'Nevera (pago de tarjeta)'],
      ['pt-pago-1-02', '24000', INTEREST, 'Intereses Nevera'],
      ['pt-pago-1-03', '18000', INTEREST, 'Manejo Visa (marzo 2026)'],
    ]);
  });

  it('recorta las descripciones a 160 caracteres', async () => {
    const { cardId, purchaseId } = await setup();
    const long = 'N'.repeat(160);
    expect(await s.cards.updatePurchase(purchaseId, { cardId, description: long, amount: '1200000', installments: 12, purchaseDate: '2026-03-02', firstDueDate: '2026-04-15', category: 'Hogar' })).toEqual({ ok: true });
    expect(await s.cards.payCard(cardId, input({ amount: '124000' }))).toEqual({ ok: true });
    const [capital, interest] = await movements();
    expect(capital!.description).toBe(`${'N'.repeat(160 - ' (pago de tarjeta)'.length)} (pago de tarjeta)`);
    expect(interest!.description).toBe(`Intereses ${long}`.slice(0, 160));
  });

  it('el saldo de la cuenta baja exactamente lo pagado', async () => {
    const { cardId } = await setup();
    const before = await balance();
    await s.cards.payCard(cardId, input({ amount: '50000' }));
    expect(BigInt(await balance())).toBe(BigInt(before) - 50_000n);
  });

  it('doble toque con el mismo id: un solo pago', async () => {
    const { cardId } = await setup();
    const [a, b] = await Promise.all([s.cards.payCard(cardId, input()), s.cards.payCard(cardId, input())]);
    expect(a).toEqual({ ok: true });
    expect(b.ok).toBe(true);
    expect(await s.cards.payCard(cardId, input())).toEqual({ ok: true });
    expect(await db.count('cardPayments')).toBe(1);
    expect((await movements()).length).toBe(2);
  });

  it('un segundo pago lleva el orden siguiente', async () => {
    const { cardId } = await setup();
    await s.cards.payCard(cardId, input());
    expect(await s.cards.payCard(cardId, input({ paymentId: 'pago-2', amount: '74000' }))).toEqual({ ok: true });
    expect((await new IdbCardPaymentRepository(db).findByCard(cardId)).map((p) => [p.id, p.seq])).toEqual([['pago-1', 1], ['pago-2', 2]]);
    expect((await s.cards.debtSummary()).debt).toBe('1100000');
  });
});

describe('payCard: validaciones', () => {
  it('monto: mayor que cero y hasta el máximo, con el mensaje del dominio', async () => {
    const { cardId } = await setup();
    expect(await s.cards.payCard(cardId, input({ amount: '0' }))).toEqual({ ok: false, error: 'El pago debe ser mayor que cero.' });
    expect(await s.cards.payCard(cardId, input({ amount: '1224001', mode: 'SHORTEN' }))).toEqual({ ok: false, error: 'El máximo que puedes pagar es $1.224.000.' });
    expect(await s.cards.payCard(cardId, input({ amount: '1224000', mode: 'SHORTEN' }))).toEqual({ ok: true });
    expect(await db.count('cardPayments')).toBe(1);
  });

  it('plata de más: el modo se pide si y solo si la hay', async () => {
    const { cardId } = await setup();
    expect(await s.cards.payCard(cardId, input({ amount: '324000' }))).toEqual({ ok: false, error: 'Elige qué hacer con la plata de más.' });
    expect(await s.cards.payCard(cardId, input({ mode: 'SHORTEN' }))).toEqual({ ok: false, error: 'Solo se elige qué hacer con la plata de más cuando la hay.' });
    expect(await db.count('cardPayments')).toBe(0);
  });

  it('fechas por el día de Colombia: a las 8 p. m. del 15 el pago cuenta para el 15, y el 16 aún es futuro', async () => {
    const { cardId } = await setup();
    expect(await s.cards.payCard(cardId, input({ paidOn: '2026-04-16' }))).toEqual({ ok: false, error: 'La fecha del pago no puede ser futura.' });
    expect(await s.cards.payCard(cardId, input({ paidOn: '2026-04-15' }))).toEqual({ ok: true });
    expect(await s.cards.payCard(cardId, input({ paymentId: 'pago-2', paidOn: '2026-04-14' }))).toEqual({
      ok: false,
      error: 'La fecha del pago no puede ser anterior al último pago de esta tarjeta.',
    });
  });

  it('cuenta y tarjeta deben existir; el id del pago debe ser válido', async () => {
    const { cardId } = await setup();
    expect((await s.cards.payCard(cardId, input({ fromAccountId: 'no-existe' }))).ok).toBe(false);
    expect(await s.cards.payCard('no-existe', input())).toEqual({ ok: false, error: 'No encontramos esa tarjeta.' });
    for (const paymentId of ['', 'con espacio', 'x'.repeat(81)]) {
      expect(await s.cards.payCard(cardId, input({ paymentId }))).toEqual({ ok: false, error: 'No pudimos registrar el pago. Cierra el formulario y ábrelo de nuevo.' });
    }
    expect(await db.count('cardPayments')).toBe(0);
    expect(await movements()).toEqual([]);
  });

  it('no pasa del tope de pagos de tarjeta que una copia puede recuperar', async () => {
    const { cardId } = await setup();
    vi.spyOn(IdbCardPaymentRepository.prototype, 'count').mockResolvedValue(20_000);
    expect(await s.cards.payCard(cardId, input())).toEqual({ ok: false, error: 'Llegaste al máximo de 20.000 pagos de tarjeta.' });
    vi.restoreAllMocks();
  });
});

describe('previewCardPayment', () => {
  it('desglosa el pago con el día de Colombia y dice el máximo', async () => {
    const { cardId, purchaseId } = await setup();
    const result = await s.cards.previewCardPayment(cardId, { amount: '324000', paidOn: '2026-04-15', fromAccountId: accountId });
    expect(result).toEqual({
      ok: true,
      preview: {
        total: '324000',
        max: '1224000',
        fees: [],
        purchases: [{ purchaseId, description: 'Nevera', interest: '24000', capital: '100000', extraCapital: '200000' }],
        extraCapital: '200000',
        needsMode: true,
        outcomes: [
          { purchaseId, SHORTEN: { remainingInstallments: 9, nextInstallment: '118000' }, LOWER: { remainingInstallments: 11, nextInstallment: String(81_819 + 18_000) } },
        ],
      },
    });
  });

  it('devuelve el error en palabras simples', async () => {
    const { cardId } = await setup();
    expect(await s.cards.previewCardPayment(cardId, { amount: '9999999', paidOn: '2026-04-15', fromAccountId: accountId })).toEqual({
      ok: false,
      error: 'El máximo que puedes pagar es $1.224.000.',
    });
    expect(await s.cards.previewCardPayment(cardId, { amount: '1000', paidOn: '2026-04-16', fromAccountId: accountId })).toEqual({
      ok: false,
      error: 'La fecha del pago no puede ser futura.',
    });
  });
});

describe('undoLastCardPayment', () => {
  it('vuelve exactamente al estado anterior: deuda, compromisos y saldos', async () => {
    const { cardId } = await setup({ feeKind: 'FIXED_MONTHLY', feeAmount: '18000' });
    await s.cards.payCard(cardId, input({ amount: '142000' }));
    const before = await state();
    await s.cards.payCard(cardId, input({ paymentId: 'pago-2', amount: '300000', mode: 'SHORTEN' }));
    expect(await s.cards.undoLastCardPayment(cardId)).toEqual({ ok: true });
    expect(await state()).toEqual(before);
    expect((await new IdbCardPaymentRepository(db).findByCard(cardId)).map((p) => p.id)).toEqual(['pago-1']);
  });

  it('deshacer el primer pago vuelve a la regla anterior (idéntico a no haber pagado)', async () => {
    const { cardId } = await setup();
    const before = await state();
    await s.cards.payCard(cardId, input());
    expect(await s.cards.undoLastCardPayment(cardId)).toEqual({ ok: true });
    expect(await state()).toEqual(before);
    expect(await db.count('cardPayments')).toBe(0);
  });

  it('un segundo toque no deshace otro pago', async () => {
    const { cardId } = await setup();
    await s.cards.payCard(cardId, input());
    await s.cards.payCard(cardId, input({ paymentId: 'pago-2', amount: '1000' }));
    expect(await s.cards.undoLastCardPayment(cardId, { paymentId: 'pago-2' })).toEqual({ ok: true });
    expect(await s.cards.undoLastCardPayment(cardId, { paymentId: 'pago-2' })).toEqual({ ok: true });
    expect(await db.count('cardPayments')).toBe(1);
  });

  it('sin pagos nuevos avisa', async () => {
    const { cardId } = await setup();
    expect(await s.cards.undoLastCardPayment(cardId)).toEqual({ ok: false, error: 'Esta tarjeta no tiene pagos para deshacer.' });
  });
});

describe('pagos y deshacer del sistema anterior', () => {
  it('funcionan mientras la tarjeta no tenga pagos nuevos', async () => {
    const { purchaseId } = await setup();
    expect(await s.cards.payInstallment(purchaseId, { fromAccountId: accountId, paidOn: '2026-04-15' })).toEqual({ ok: true });
    expect(await s.cards.undoLastPayment(purchaseId)).toEqual({ ok: true });
  });

  it('con pagos nuevos se rechazan todos con el mismo mensaje', async () => {
    const { cardId, purchaseId } = await setup({ feeKind: 'FIXED_MONTHLY', feeAmount: '18000' });
    expect(await s.cards.payInstallment(purchaseId, { fromAccountId: accountId, paidOn: '2026-04-15' })).toEqual({ ok: true });
    expect(await s.cards.payFee(cardId, '2026-03', { fromAccountId: accountId, paidOn: '2026-04-15' })).toEqual({ ok: true });
    expect(await s.cards.payCard(cardId, input({ amount: '1000', mode: 'SHORTEN' }))).toEqual({ ok: true });
    const rows = (await db.getAll('transactions')).length;
    const fail = { ok: false, error: LEGACY };
    expect(await s.cards.undoLastPayment(purchaseId)).toEqual(fail);
    expect(await s.cards.undoLastFee(cardId)).toEqual(fail);
    expect(await s.cards.payInstallment(purchaseId, { fromAccountId: accountId, paidOn: '2026-04-15' })).toEqual(fail);
    expect(await s.cards.settle(purchaseId, { fromAccountId: accountId, paidOn: '2026-04-15' })).toEqual(fail);
    expect(await s.cards.payFee(cardId, '2026-04', { fromAccountId: accountId, paidOn: '2026-04-15' })).toEqual(fail);
    expect((await db.getAll('transactions')).length).toBe(rows);
  });
});

describe('Historial: movimientos de un pago de tarjeta', () => {
  it('no se editan ni se borran mientras exista el pago', async () => {
    const { cardId } = await setup();
    await s.cards.payCard(cardId, input());
    const item = (await s.transactions.page()).items.find((t) => t.id === 'pt-pago-1-01')!;
    expect(item.cardPayment).toEqual({ message: IN_PAYMENT, canDelete: false });
    expect(await s.transactions.remove('pt-pago-1-01')).toEqual({ ok: false, error: IN_PAYMENT });
    expect(await s.transactions.update('pt-pago-1-01', { type: 'EXPENSE', amount: '1', date: '2026-04-15', description: 'x', accountId })).toEqual({ ok: false, error: IN_PAYMENT });
  });

  it('si el pago ya no existe (se borró la tarjeta), se pueden borrar como huérfanos', async () => {
    const { cardId } = await setup();
    await s.cards.payCard(cardId, input());
    expect(await s.cards.removeCard(cardId)).toEqual({ ok: true });
    expect(await db.count('cardPayments')).toBe(0);
    const item = (await s.transactions.get('pt-pago-1-01'))!;
    expect(item.cardPayment?.canDelete).toBe(true);
    expect(await s.transactions.remove('pt-pago-1-01')).toEqual({ ok: true });
  });
});

describe('borrar o editar una compra con pagos nuevos', () => {
  it('borrar la compra conserva sus pagos; el cálculo ignora lo que iba a ella', async () => {
    const { cardId, purchaseId } = await setup();
    await s.cards.addPurchase({ cardId, description: 'TV', amount: '600000', installments: 6, purchaseDate: '2026-03-02', firstDueDate: '2026-04-15', category: 'Hogar' });
    await s.cards.payCard(cardId, input());
    expect(await s.cards.removePurchase(purchaseId)).toEqual({ ok: true });
    expect(await db.count('cardPayments')).toBe(1);
    expect((await s.cards.debtSummary()).debt).toBe('600000');
    expect((await s.summary.projection('2026-12-31')).commitments.length).toBeGreaterThan(0);
    expect((await s.cards.previewCardPayment(cardId, { amount: '1000', paidOn: '2026-04-15', fromAccountId: accountId })).ok).toBe(true);
  });

  it('editar: solo descripción y categoría', async () => {
    const { cardId, purchaseId } = await setup();
    await s.cards.payCard(cardId, input());
    const base = { cardId, description: 'Nevera', amount: '1200000', installments: 12, purchaseDate: '2026-03-02', firstDueDate: '2026-04-15', category: 'Hogar' };
    expect(await s.cards.updatePurchase(purchaseId, { ...base, amount: '1000000' })).toEqual({
      ok: false,
      error: 'Esta compra ya tiene cuotas pagadas: solo puedes cambiar la descripción y la categoría.',
    });
    expect(await s.cards.updatePurchase(purchaseId, { ...base, description: 'Nevera grande', category: 'Casa' })).toEqual({ ok: true });
  });
});

describe('Saldo Real y deuda', () => {
  it('sin pagos nuevos, los compromisos son exactamente los de hoy', async () => {
    const { cardId } = await setup({ feeKind: 'FIXED_MONTHLY', feeAmount: '18000', cutDay: 30 });
    await s.cards.addPurchase({ cardId, description: 'TV', amount: '600000', installments: 6, purchaseDate: '2026-04-01', firstDueDate: '2026-05-15', category: 'Hogar' });
    const { IdbCreditCardRepository, IdbCardPurchaseRepository } = await import('@/data/idb-card.repository');
    const cards = await new IdbCreditCardRepository(db).findAll();
    const purchases = await new IdbCardPurchaseRepository(db).findAll();
    expect(purchases).toHaveLength(2);
    // Lo que daba la app antes de los pagos nuevos, calculado con la función de hoy.
    const expected = cardCommitments(cards, purchases, startOfDayUTC(new Date('2026-04-15T00:00:00Z')), new Date('2027-06-30T00:00:00Z'));
    expect(expected.length).toBeGreaterThan(10);
    const projection = await s.summary.projection('2027-06-30');
    expect(projection.commitments.map((c) => [c.scheduledExpenseId, c.description, c.date, c.amount.amount])).toEqual(
      expected.map((c) => [c.scheduledExpenseId, c.description, c.date.toISOString().slice(0, 10), c.amount.amount.toString()]),
    );
    expect((await s.cards.debtSummary()).debt).toBe('1800000');
  });

  it('con un pago parcial, resta solo lo que falta de la cuota', async () => {
    const { cardId, purchaseId } = await setup();
    const before = await s.summary.projection('2026-04-15');
    await s.cards.payCard(cardId, input());
    const after = await s.summary.projection('2026-04-15');
    const cuota1 = after.commitments.find((c) => c.scheduledExpenseId === purchaseId)!;
    expect([cuota1.description, cuota1.amount.amount]).toEqual(['Nevera (cuota 1/12)', '74000']);
    expect(BigInt(after.committed.amount)).toBe(BigInt(before.committed.amount) - 50_000n);
    expect(after.availableBalance).toEqual(before.availableBalance);
    expect((await s.cards.debtSummary()).debt).toBe('1174000');
  });
});

describe('quitar datos de ejemplo con pagos nuevos', () => {
  it('quita los pagos de ejemplo y sus movimientos; conserva los propios', async () => {
    const { cardId } = await setup();
    await s.cards.payCard(cardId, input());
    await db.put('creditCards', { ...(await db.get('creditCards', cardId))!, id: `${SAMPLE_PREFIX}visa` });
    const own = (await db.get('cardPayments', 'pago-1'))!;
    await db.put('cardPayments', { ...own, id: `${SAMPLE_PREFIX}p1`, cardId: `${SAMPLE_PREFIX}visa`, transactionIds: [`pt-${SAMPLE_PREFIX}p1-01`] });
    await db.put('transactions', { ...(await db.get('transactions', 'pt-pago-1-01'))!, id: `pt-${SAMPLE_PREFIX}p1-01` });
    await db.put('cardPayments', { ...own, id: 'mine-on-demo-card', cardId: `${SAMPLE_PREFIX}visa`, seq: 2, transactionIds: [] });
    expect(await s.data.removeSample()).toEqual({ ok: true });
    expect((await db.getAll('cardPayments')).map((p) => p.id)).toEqual(['pago-1']);
    expect((await db.getAll('transactions')).map((t) => t.id).filter((id) => id.startsWith('pt-'))).toEqual(['pt-pago-1-01', 'pt-pago-1-02']);
  });
});

describe('editar una tarjeta con pagos nuevos', () => {
  const CUT_LOCKED = 'Esta tarjeta ya tiene pagos con el pago único. Para cambiar el día de corte, primero deshazlos con «Deshacer último pago de la tarjeta».';
  const card = { name: 'Visa', dueDay: 15, paymentAccountId: '', feeKind: 'NONE' as const, rateBasis: 'MV' as const, rateText: '2' };

  it('no deja cambiar el día de corte (cambiaría el interés ya repartido); lo demás sí', async () => {
    const { cardId } = await setup();
    await s.cards.payCard(cardId, input());
    expect(await s.cards.updateCard(cardId, { ...card, paymentAccountId: accountId, cutDay: 30 })).toEqual({ ok: false, error: CUT_LOCKED });
    expect(await s.cards.updateCard(cardId, { ...card, paymentAccountId: accountId, name: 'Visa oro' })).toEqual({ ok: true });
  });

  it('sin pagos nuevos se cambia como siempre', async () => {
    const { cardId } = await setup();
    expect(await s.cards.updateCard(cardId, { ...card, paymentAccountId: accountId, cutDay: 30 })).toEqual({ ok: true });
  });
});

describe('quitar datos de ejemplo no deja un historial de pagos a medias', () => {
  it('si una tarjeta propia tiene pagos desde una cuenta de ejemplo, no quita nada y lo dice', async () => {
    const { cardId } = await setup();
    await db.put('accounts', { id: `${SAMPLE_PREFIX}banco`, name: 'Banco de ejemplo', type: 'BANK', initialBalance: '5000000', currency: 'COP' });
    expect(await s.cards.payCard(cardId, input({ amount: '124000', fromAccountId: `${SAMPLE_PREFIX}banco` }))).toEqual({ ok: true });
    expect(await s.cards.payCard(cardId, input({ paymentId: 'pago-2', amount: '200000', mode: 'SHORTEN' }))).toEqual({ ok: true });
    const before = { payments: await db.count('cardPayments'), rows: await db.count('transactions'), accounts: await db.count('accounts') };

    expect(await s.data.removeSample()).toEqual({
      ok: false,
      error: 'Antes de quitar los datos de ejemplo, deshaz los pagos de la tarjeta «Visa» hechos desde una cuenta de ejemplo.',
    });
    expect({ payments: await db.count('cardPayments'), rows: await db.count('transactions'), accounts: await db.count('accounts') }).toEqual(before);
    expect((await s.cards.list())[0]!.debt).toBe('900000');
  });
});
