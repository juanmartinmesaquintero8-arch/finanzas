import { CardPurchase, Money, TransactionFactory, createCardPayment, type Allocation, type CardPayment, type Transaction } from '@finanzas/domain';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openFinanzasDb, type FinanzasDb, type StoredCardPayment, type StoredCreditCard } from './database';
import { IdbCardPaymentRepository } from './idb-card.repository';
import { IdbLedgerStore, LegacyLockedError } from './idb-ledger-store';
import { toCardPayment, toStoredCardPayment, toStoredCardPurchase } from './mappers';

let name = '';
let db: FinanzasDb;
let n = 0;

beforeEach(async () => {
  name = `card-payments-${++n}-${Math.random()}`;
  db = await openFinanzasDb(name);
  // El pago se guarda solo si su tarjeta existe.
  await db.put('creditCards', card('c1'));
  await db.put('creditCards', card('c2'));
});
afterEach(async () => {
  db.close();
  await deleteDB(name);
});

const cop = (v: number) => Money.of(v, 'COP');
const day = (s: string) => new Date(`${s}T00:00:00Z`);

const allocations: Allocation[] = [
  { kind: 'FEE', month: '2026-03', amount: cop(18_000) },
  { kind: 'INSTALLMENT', purchaseId: 'p1', number: 1, interest: cop(24_000), capital: cop(100_000) },
  { kind: 'EXTRA', purchaseId: 'p1', capital: cop(50_000) },
];

function payment(id: string, seq: number, over: Partial<Parameters<typeof createCardPayment>[0]> = {}): CardPayment {
  return createCardPayment({
    id,
    cardId: 'c1',
    seq,
    paidOn: day('2026-04-15'),
    fromAccountId: 'a1',
    total: cop(192_000),
    allocations,
    extraMode: 'SHORTEN',
    transactionIds: [`pt-${id}-01`, `pt-${id}-02`],
    ...over,
  });
}

const movement = (id: string): Transaction =>
  TransactionFactory.create({ type: 'EXPENSE', id, accountId: 'a1', amount: cop(1_000), date: day('2026-04-15'), description: 'Pago' });
const movementsOf = (p: CardPayment) => p.transactionIds.map(movement);

const card = (id: string): StoredCreditCard => ({
  id, name: 'Visa', dueDay: 15, paymentAccountId: 'a1', feeKind: 'NONE', feeAmount: null, currency: 'COP', rateBasis: null, ratePpm: null, feeStartMonth: '2026-03', feesSettledThrough: null,
});

describe('mappers de pagos de tarjeta', () => {
  it('guarda montos como texto de bigint y fechas ISO, y vuelve al mismo pago', () => {
    const p = payment('x1', 1);
    const row = toStoredCardPayment(p);
    expect(row).toEqual<StoredCardPayment>({
      id: 'x1',
      cardId: 'c1',
      seq: 1,
      paidOn: '2026-04-15T00:00:00.000Z',
      fromAccountId: 'a1',
      total: '192000',
      currency: 'COP',
      extraMode: 'SHORTEN',
      allocations: [
        { kind: 'FEE', month: '2026-03', amount: '18000' },
        { kind: 'INSTALLMENT', purchaseId: 'p1', number: 1, interest: '24000', capital: '100000' },
        { kind: 'EXTRA', purchaseId: 'p1', capital: '50000' },
      ],
      transactionIds: ['pt-x1-01', 'pt-x1-02'],
    });
    expect(toCardPayment(row)).toEqual(p);
  });

  it('sin plata de más guarda el modo como null y lo lee como ausente', () => {
    const p = payment('x2', 1, { total: cop(18_000), allocations: [allocations[0]!], extraMode: undefined });
    expect(toStoredCardPayment(p).extraMode).toBeNull();
    expect(toCardPayment(toStoredCardPayment(p))).toEqual(p);
  });
});

describe('writeCardPaymentEvent', () => {
  it('guarda el pago y sus movimientos juntos', async () => {
    const store = new IdbLedgerStore(db);
    const p = payment('x1', 1);
    expect(await store.writeCardPaymentEvent(0, p, movementsOf(p), [])).toBe('written');
    expect((await db.getAll('transactions')).map((t) => t.id)).toEqual(['pt-x1-01', 'pt-x1-02']);
    const repo = new IdbCardPaymentRepository(db);
    expect(await repo.findById('x1')).toEqual(p);
    expect(await repo.count()).toBe(1);
  });

  it('repetir el mismo id no duplica nada: devuelve "ya registrado"', async () => {
    const store = new IdbLedgerStore(db);
    const p = payment('x1', 1);
    await store.writeCardPaymentEvent(0, p, movementsOf(p), []);
    const again = payment('x1', 2, { transactionIds: ['pt-x1-09'] });
    expect(await store.writeCardPaymentEvent(1, again, movementsOf(again), [])).toBe('already');
    expect(await db.count('cardPayments')).toBe(1);
    expect((await db.getAll('transactions')).map((t) => t.id)).toEqual(['pt-x1-01', 'pt-x1-02']);
  });

  it('si el último orden de la tarjeta no es el esperado, no escribe nada: devuelve "cambió"', async () => {
    const store = new IdbLedgerStore(db);
    const first = payment('x1', 1);
    await store.writeCardPaymentEvent(0, first, movementsOf(first), []);
    const stale = payment('x2', 1);
    expect(await store.writeCardPaymentEvent(0, stale, movementsOf(stale), [])).toBe('changed');
    const skipped = payment('x3', 3);
    expect(await store.writeCardPaymentEvent(2, skipped, movementsOf(skipped), [])).toBe('changed');
    expect((await db.getAll('cardPayments')).map((r) => r.id)).toEqual(['x1']);
    expect(await db.count('transactions')).toBe(2);
  });

  it('el orden de otra tarjeta no cuenta', async () => {
    const store = new IdbLedgerStore(db);
    const other = payment('y1', 1, { cardId: 'c2' });
    await store.writeCardPaymentEvent(0, other, movementsOf(other), []);
    const mine = payment('x1', 1);
    expect(await store.writeCardPaymentEvent(0, mine, movementsOf(mine), [])).toBe('written');
  });

  it('es atómico: si falla un movimiento no queda ni el pago ni ningún movimiento', async () => {
    const store = new IdbLedgerStore(db);
    const p = payment('x1', 1);
    const bad = { ...movement('pt-x1-02'), id: undefined } as unknown as Transaction; // clave inválida
    await expect(store.writeCardPaymentEvent(0, p, [movement('pt-x1-01'), bad], [])).rejects.toBeDefined();
    expect(await db.count('cardPayments')).toBe(0);
    expect(await db.count('transactions')).toBe(0);
  });

  it('es atómico: si un movimiento ya existe, no escribe nada', async () => {
    await db.put('transactions', (await import('./mappers')).toStoredTransaction(movement('pt-x1-02')));
    const store = new IdbLedgerStore(db);
    const p = payment('x1', 1);
    await expect(store.writeCardPaymentEvent(0, p, movementsOf(p), [])).rejects.toBeDefined();
    expect(await db.count('cardPayments')).toBe(0);
    expect((await db.getAll('transactions')).map((t) => t.id)).toEqual(['pt-x1-02']);
  });

  it('rechaza un pago cuyo orden no sigue al esperado', async () => {
    const p = payment('x1', 3);
    await expect(new IdbLedgerStore(db).writeCardPaymentEvent(0, p, movementsOf(p), [])).rejects.toThrow();
    expect(await db.count('cardPayments')).toBe(0);
  });
});

describe('removeCardPaymentEvent', () => {
  it('quita el último pago de la tarjeta y sus movimientos, nada más', async () => {
    const store = new IdbLedgerStore(db);
    const first = payment('x1', 1);
    const second = payment('x2', 2);
    await store.writeCardPaymentEvent(0, first, movementsOf(first), []);
    await store.writeCardPaymentEvent(1, second, movementsOf(second), []);
    await db.put('transactions', (await import('./mappers')).toStoredTransaction(movement('t-otro')));

    expect(await store.removeCardPaymentEvent(second)).toBe(true);
    expect((await db.getAll('cardPayments')).map((r) => r.id)).toEqual(['x1']);
    expect((await db.getAll('transactions')).map((t) => t.id).sort()).toEqual(['pt-x1-01', 'pt-x1-02', 't-otro']);
  });

  it('no borra nada si el pago no es el último de la tarjeta', async () => {
    const store = new IdbLedgerStore(db);
    const first = payment('x1', 1);
    const second = payment('x2', 2);
    await store.writeCardPaymentEvent(0, first, movementsOf(first), []);
    await store.writeCardPaymentEvent(1, second, movementsOf(second), []);
    expect(await store.removeCardPaymentEvent(first)).toBe(false);
    expect(await db.count('cardPayments')).toBe(2);
    expect(await db.count('transactions')).toBe(4);
  });

  it('no borra nada si el pago ya no existe', async () => {
    expect(await new IdbLedgerStore(db).removeCardPaymentEvent(payment('x1', 1))).toBe(false);
  });
});

describe('repositorio de pagos de tarjeta', () => {
  it('lista los pagos de una tarjeta en orden', async () => {
    const store = new IdbLedgerStore(db);
    for (const [id, seq, cardId] of [['x1', 1, 'c1'], ['y1', 1, 'c2'], ['x2', 2, 'c1']] as const) {
      const p = payment(id, seq, { cardId });
      await store.writeCardPaymentEvent(seq - 1, p, movementsOf(p), []);
    }
    const repo = new IdbCardPaymentRepository(db);
    expect((await repo.findByCard('c1')).map((p) => p.id)).toEqual(['x1', 'x2']);
    expect((await repo.findAll()).map((p) => p.id).sort()).toEqual(['x1', 'x2', 'y1']);
    expect(await repo.findById('nada')).toBeNull();
  });
});

describe('pagos de tarjeta en las operaciones de todo el libro', () => {
  async function seed() {
    const store = new IdbLedgerStore(db);
    await db.put('creditCards', card('c1'));
    const p = payment('x1', 1);
    await store.writeCardPaymentEvent(0, p, movementsOf(p), []);
    return { store, p };
  }

  it('borrar la tarjeta borra sus pagos y deja sus movimientos', async () => {
    const { store } = await seed();
    const other = payment('y1', 1, { cardId: 'c2' });
    await store.writeCardPaymentEvent(0, other, movementsOf(other), []);
    await store.deleteCard('c1');
    expect((await db.getAll('cardPayments')).map((r) => r.id)).toEqual(['y1']);
    expect(await db.count('transactions')).toBe(4);
  });

  it('readAll y readExtras los incluyen', async () => {
    const { store, p } = await seed();
    expect((await store.readAll()).cardPayments).toEqual([p]);
    expect((await store.readExtras()).cardPayments).toEqual([toStoredCardPayment(p)]);
  });

  it('replaceAll los reemplaza (por entidades o por filas) y una copia sin ellos los deja vacíos', async () => {
    const { store, p } = await seed();
    const base = { accounts: [], transactions: [], scheduledExpenses: [], scheduledIncomes: [] };
    await store.replaceAll(base);
    expect(await db.count('cardPayments')).toBe(0);
    await store.replaceAll({ ...base, cardPayments: [p] });
    expect(await new IdbCardPaymentRepository(db).findAll()).toEqual([p]);
    await store.replaceAll(base, { cardPayments: [toStoredCardPayment(payment('z1', 1))] });
    expect((await db.getAll('cardPayments')).map((r) => r.id)).toEqual(['z1']);
  });

  it('clearAll los vacía', async () => {
    const { store } = await seed();
    await store.clearAll();
    expect(await db.count('cardPayments')).toBe(0);
  });
});

describe('escrituras del sistema anterior con pagos nuevos en la tarjeta', () => {
  it('no escriben nada si la tarjeta ya tiene un pago nuevo (aunque se crucen con él)', async () => {
    const { CreditCard } = await import('@finanzas/domain');
    const store = new IdbLedgerStore(db);
    const p = payment('x1', 1);
    await store.writeCardPaymentEvent(0, p, movementsOf(p), []);
    const visa = CreditCard.create({ id: 'c1', name: 'Visa', dueDay: 15, paymentAccountId: 'a1', fee: { kind: 'FIXED_MONTHLY', amount: cop(18_000) }, feeStartMonth: '2026-03' });
    await db.put('creditCards', (await import('./mappers')).toStoredCreditCard(visa));
    const nevera = CardPurchase.create({
      id: 'p1', cardId: 'c1', description: 'Nevera', amount: cop(1_200), installments: 12, purchaseDate: day('2026-03-02'), firstDueDate: day('2026-04-15'), monthlyRatePpm: 0, paidInstallments: 0,
    });
    await db.put('cardPurchases', (await import('./mappers')).toStoredCardPurchase(nevera));
    const paidVisa = CreditCard.create({ ...visa.toProps(), feesSettledThrough: '2026-03' });

    await expect(store.writeCardPayment(nevera, nevera.markPaid(1), [movement('cp-p1-1')])).rejects.toBeInstanceOf(LegacyLockedError);
    await expect(store.writeFeePayment(visa, paidVisa, movement('cf-c1-2026-03'))).rejects.toBeInstanceOf(LegacyLockedError);
    expect((await db.get('creditCards', 'c1'))!.feesSettledThrough).toBeNull();
    await db.put('creditCards', (await import('./mappers')).toStoredCreditCard(paidVisa));
    await expect(store.writeFeeUndo(paidVisa, visa, 'pt-x1-01')).rejects.toBeInstanceOf(LegacyLockedError);
    expect((await db.get('cardPurchases', 'p1'))!.paidInstallments).toBe(0);
    expect((await db.get('creditCards', 'c1'))!.feesSettledThrough).toBe('2026-03');
    expect((await db.getAll('transactions')).map((t) => t.id)).toEqual(['pt-x1-01', 'pt-x1-02']);
  });
});

describe('writeCardPaymentEvent: la tarjeta y sus compras siguen como en el desglose', () => {
  const nevera = (over: Record<string, unknown> = {}) =>
    CardPurchase.create({
      id: 'p1', cardId: 'c1', description: 'Nevera', amount: cop(1_200_000), installments: 12, purchaseDate: day('2026-03-02'), firstDueDate: day('2026-04-15'),
      monthlyRatePpm: 20_000, paidInstallments: 0, ...over,
    });

  it('con las mismas compras guarda', async () => {
    await db.put('cardPurchases', toStoredCardPurchase(nevera()));
    const p = payment('x1', 1);
    expect(await new IdbLedgerStore(db).writeCardPaymentEvent(0, p, movementsOf(p), [nevera()])).toBe('written');
  });

  it('si la tarjeta se borró entretanto, no escribe nada', async () => {
    await db.delete('creditCards', 'c1');
    const p = payment('x1', 1);
    expect(await new IdbLedgerStore(db).writeCardPaymentEvent(0, p, movementsOf(p), [])).toBe('changed');
    expect(await db.count('cardPayments')).toBe(0);
    expect(await db.count('transactions')).toBe(0);
  });

  it('si una compra cambió entretanto (cuota pagada, liquidada, nueva o borrada), no escribe nada', async () => {
    const store = new IdbLedgerStore(db);
    const p = payment('x1', 1);
    await db.put('cardPurchases', toStoredCardPurchase(nevera({ paidInstallments: 1 })));
    expect(await store.writeCardPaymentEvent(0, p, movementsOf(p), [nevera()])).toBe('changed');
    await db.put('cardPurchases', toStoredCardPurchase(nevera().close(day('2026-04-10'))));
    expect(await store.writeCardPaymentEvent(0, p, movementsOf(p), [nevera()])).toBe('changed');
    await db.put('cardPurchases', toStoredCardPurchase(nevera()));
    await db.put('cardPurchases', toStoredCardPurchase(nevera({ id: 'p2' })));
    expect(await store.writeCardPaymentEvent(0, p, movementsOf(p), [nevera()])).toBe('changed');
    await db.delete('cardPurchases', 'p2');
    await db.delete('cardPurchases', 'p1');
    expect(await store.writeCardPaymentEvent(0, p, movementsOf(p), [nevera()])).toBe('changed');
    expect(await db.count('cardPayments')).toBe(0);
    expect(await db.count('transactions')).toBe(0);
  });
});
