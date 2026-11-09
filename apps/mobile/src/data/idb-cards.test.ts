import { CardPurchase, CreditCard, InterestRate, Money, TransactionFactory } from '@finanzas/domain';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openFinanzasDb, type FinanzasDb, type StoredCardPurchase } from './database';
import { IdbCardPurchaseRepository, IdbCreditCardRepository } from './idb-card.repository';
import { IdbLedgerStore } from './idb-ledger-store';

let name = '';
let db: FinanzasDb;
let n = 0;

beforeEach(async () => {
  name = `cards-${++n}-${Math.random()}`;
  db = await openFinanzasDb(name);
});
afterEach(async () => {
  db.close();
  await deleteDB(name);
});

const cop = (v: bigint) => Money.of(v, 'COP');
const day = (d: string) => new Date(`${d}T00:00:00Z`);

const card = (over: Partial<Parameters<typeof CreditCard.create>[0]> = {}) =>
  CreditCard.create({
    id: 'c1',
    name: 'Visa',
    dueDay: 31,
    paymentAccountId: 'a1',
    fee: { kind: 'FIXED_MONTHLY', amount: cop(18_000n) },
    rate: InterestRate.create({ basis: 'EA', ppm: 268_200 }),
    feeStartMonth: '2026-03',
    ...over,
  });

const purchase = (over: Partial<Parameters<typeof CardPurchase.create>[0]> = {}) =>
  CardPurchase.create({
    id: 'p1',
    cardId: 'c1',
    description: 'TV',
    category: 'Hogar',
    amount: cop(1_200_000n),
    installments: 12,
    purchaseDate: day('2026-01-15'),
    firstDueDate: day('2026-02-28'),
    monthlyRatePpm: 20_000,
    paidInstallments: 0,
    dueDayAnchor: 31,
    ...over,
  });

const expense = (id: string) =>
  TransactionFactory.create({ type: 'EXPENSE', id, accountId: 'a1', amount: cop(100n), date: day('2026-03-10'), description: 'x', category: 'y' });

describe('repositorios de tarjetas y compras', () => {
  it('guarda y recupera una tarjeta con su manejo, tasa y meses', async () => {
    const repo = new IdbCreditCardRepository(db);
    await repo.save(card({ feesSettledThrough: '2026-04' }));
    const [found] = await repo.findAll();
    expect(found!.toProps()).toEqual(card({ feesSettledThrough: '2026-04' }).toProps());
    expect(await repo.findById('nope')).toBeNull();
    await repo.save(card({ id: 'c2', fee: { kind: 'NONE' }, rate: undefined }));
    expect((await repo.findById('c2'))!.toProps()).toMatchObject({ fee: { kind: 'NONE' }, rate: undefined });
    await repo.delete('c2');
    expect(await repo.findById('c2')).toBeNull();
  });

  it('guarda y recupera una compra conservando dueDayAnchor', async () => {
    const repo = new IdbCardPurchaseRepository(db);
    await repo.save(purchase());
    expect((await repo.findById('p1'))!.toProps()).toEqual(purchase().toProps());
    await repo.save(purchase({ id: 'p2', dueDayAnchor: undefined, category: undefined, closedOn: day('2026-03-01') }));
    const stored = (await db.get('cardPurchases', 'p2'))!;
    expect(stored.dueDayAnchor).toBeNull();
    expect(stored.closedOn).toBe('2026-03-01T00:00:00.000Z');
    expect((await repo.findById('p2'))!.dueDayAnchor).toBeUndefined();
    expect(await repo.findByCard('c1')).toHaveLength(2);
    expect(await repo.findByCard('otra')).toEqual([]);
  });

  it('una fila guardada sin dueDayAnchor (antes de existir el campo) se lee sin él', async () => {
    const legacy: StoredCardPurchase = {
      id: 'old', cardId: 'c1', description: 'Viejo', category: null, amount: '100', currency: 'COP', installments: 1,
      purchaseDate: '2026-03-01T00:00:00.000Z', firstDueDate: '2026-04-15T00:00:00.000Z', monthlyRatePpm: 0, paidInstallments: 0, closedOn: null,
    };
    await db.put('cardPurchases', legacy);
    expect((await new IdbCardPurchaseRepository(db).findById('old'))!.dueDayAnchor).toBeUndefined();
  });
});

describe('writeCardPayment: el pago es todo o nada', () => {
  it('guarda los movimientos y la compra juntos', async () => {
    const store = new IdbLedgerStore(db);
    await new IdbCardPurchaseRepository(db).save(purchase());
    expect(await store.writeCardPayment(purchase(), purchase({ paidInstallments: 1 }), [expense('cp-p1-1'), expense('ci-p1-1')])).toBe(true);
    expect((await db.getAll('transactions')).map((r) => r.id).sort()).toEqual(['ci-p1-1', 'cp-p1-1']);
    expect((await db.get('cardPurchases', 'p1'))!.paidInstallments).toBe(1);
  });

  it('si una fila falla no queda nada a medias', async () => {
    const store = new IdbLedgerStore(db);
    await new IdbCardPurchaseRepository(db).save(purchase());
    const bad = { ...expense('x'), id: undefined } as unknown as ReturnType<typeof expense>;
    await expect(store.writeCardPayment(purchase(), purchase({ paidInstallments: 1 }), [expense('cp-p1-1'), bad])).rejects.toBeDefined();
    expect(await db.count('transactions')).toBe(0);
    expect((await db.get('cardPurchases', 'p1'))!.paidInstallments).toBe(0);
  });

  it('si la compra ya cambió desde que se leyó, no escribe nada y lo dice', async () => {
    const store = new IdbLedgerStore(db);
    await new IdbCardPurchaseRepository(db).save(purchase({ paidInstallments: 1 }));
    expect(await store.writeCardPayment(purchase(), purchase({ paidInstallments: 1 }), [expense('cp-p1-1')])).toBe(false);
    expect(await db.count('transactions')).toBe(0);
  });

  it('borra los movimientos indicados en la misma escritura', async () => {
    const store = new IdbLedgerStore(db);
    await new IdbCardPurchaseRepository(db).save(purchase({ paidInstallments: 1 }));
    await store.writeCardPayment(purchase(), purchase(), []).catch(() => undefined);
    await db.put('transactions', { id: 'cp-p1-1', type: 'EXPENSE', amount: '1', currency: 'COP', date: '2026-03-10T00:00:00.000Z', description: 'x', category: null, accountId: 'a1', fromAccountId: null, toAccountId: null, accountDates: [] });
    expect(await store.writeCardPayment(purchase({ paidInstallments: 1 }), purchase(), [], ['cp-p1-1', 'ci-p1-1'])).toBe(true);
    expect(await db.count('transactions')).toBe(0);
    expect((await db.get('cardPurchases', 'p1'))!.paidInstallments).toBe(0);
  });
});

describe('writeFeePayment y deleteCard', () => {
  it('guarda el gasto y el mes pagado juntos; si ya cambió no escribe', async () => {
    const store = new IdbLedgerStore(db);
    await new IdbCreditCardRepository(db).save(card());
    expect(await store.writeFeePayment(card(), card({ feesSettledThrough: '2026-03' }), expense('cf-c1-2026-03'))).toBe(true);
    expect((await db.get('creditCards', 'c1'))!.feesSettledThrough).toBe('2026-03');
    expect(await db.count('transactions')).toBe(1);
    expect(await store.writeFeePayment(card(), card({ feesSettledThrough: '2026-03' }), expense('cf-c1-otra'))).toBe(false);
    expect(await db.count('transactions')).toBe(1);
  });

  it('borrar la tarjeta se lleva sus compras y deja las de otras, en una escritura', async () => {
    const store = new IdbLedgerStore(db);
    const cards = new IdbCreditCardRepository(db);
    const purchases = new IdbCardPurchaseRepository(db);
    await cards.save(card());
    await cards.save(card({ id: 'c2' }));
    await purchases.save(purchase());
    await purchases.save(purchase({ id: 'p2' }));
    await purchases.save(purchase({ id: 'p3', cardId: 'c2' }));
    await store.deleteCard('c1');
    expect((await cards.findAll()).map((c) => c.id)).toEqual(['c2']);
    expect((await purchases.findAll()).map((p) => p.id)).toEqual(['p3']);
  });
});

describe('readAll y replaceAll con tarjetas', () => {
  it('leen y restauran tarjetas y compras como entidades', async () => {
    const store = new IdbLedgerStore(db);
    await store.replaceAll({ accounts: [], transactions: [], scheduledExpenses: [], scheduledIncomes: [], creditCards: [card()], cardPurchases: [purchase()] });
    const all = await store.readAll();
    expect(all.creditCards.map((c) => c.toProps())).toEqual([card().toProps()]);
    expect(all.cardPurchases.map((p) => p.toProps())).toEqual([purchase().toProps()]);
  });
});
