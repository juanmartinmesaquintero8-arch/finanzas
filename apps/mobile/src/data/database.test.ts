import { Account, Money, ScheduledExpense, TransactionFactory } from '@finanzas/domain';
import { deleteDB, openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DB_VERSION, openFinanzasDb, type FinanzasDb } from './database';
import { IdbAccountRepository } from './idb-account.repository';
import { IdbLedgerStore } from './idb-ledger-store';
import { IdbScheduledExpenseRepository } from './idb-scheduled-expense.repository';
import { IdbTransactionRepository } from './idb-transaction.repository';

const cop = (n: number) => Money.of(n, 'COP');
let name = '';
let counter = 0;
const open: FinanzasDb[] = [];

beforeEach(() => {
  name = `schema-${++counter}-${Math.random()}`;
});
afterEach(async () => {
  while (open.length) open.pop()!.close();
  await deleteDB(name);
});

/** Esquema v1 copiado LITERALMENTE de la versión que hoy tiene el celular del dueño (no se importa). */
async function createV1(dbName: string) {
  const db = await openDB(dbName, 1, {
    upgrade(d) {
      d.createObjectStore('accounts', { keyPath: 'id' });
      const transactions = d.createObjectStore('transactions', { keyPath: 'id' });
      transactions.createIndex('by-date', 'date');
      transactions.createIndex('by-account-date', 'accountDates', { multiEntry: true });
      const scheduled = d.createObjectStore('scheduledExpenses', { keyPath: 'id' });
      scheduled.createIndex('by-account', 'accountId');
      d.createObjectStore('meta', { keyPath: 'key' });
    },
  });
  await db.put('accounts', { id: 'a1', name: 'Bancolombia', type: 'BANK', initialBalance: '1500000', currency: 'COP' });
  await db.put('accounts', { id: 'a2', name: 'Efectivo', type: 'CASH', initialBalance: '20000', currency: 'COP' });
  await db.put('transactions', {
    id: 't1', type: 'EXPENSE', amount: '35000', currency: 'COP', date: '2026-03-01T12:00:00.000Z',
    description: 'Mercado', category: 'Mercado', accountId: 'a1', fromAccountId: null, toAccountId: null,
    accountDates: ['a1|2026-03-01T12:00:00.000Z'],
  });
  await db.put('transactions', {
    id: 't2', type: 'TRANSFER', amount: '5000', currency: 'COP', date: '2026-03-02T12:00:00.000Z',
    description: 'Retiro', category: null, accountId: null, fromAccountId: 'a1', toAccountId: 'a2',
    accountDates: ['a1|2026-03-02T12:00:00.000Z', 'a2|2026-03-02T12:00:00.000Z'],
  });
  await db.put('scheduledExpenses', {
    id: 's1', description: 'Arriendo', amount: '900000', currency: 'COP', accountId: 'a1',
    frequency: 'MONTHLY', startDate: '2026-04-05', endDate: null, settledThrough: null,
  });
  await db.put('meta', { key: 'lastBackupAt', value: '2026-03-01T00:00:00.000Z' });
  db.close();
}

const openV2 = async (n = name) => {
  const db = await openFinanzasDb(n);
  open.push(db);
  return db;
};

describe('actualización v1 -> v2', () => {
  it('DB_VERSION es 2', () => {
    expect(DB_VERSION).toBe(2);
  });

  it('conserva intactos los datos reales de una base v1 y deja los almacenes nuevos vacíos', async () => {
    await createV1(name);
    const db = await openV2();
    expect(db.version).toBe(2);
    expect([...db.objectStoreNames].sort()).toEqual(
      ['accounts', 'cardPurchases', 'creditCards', 'meta', 'scheduledExpenses', 'scheduledIncomes', 'transactions'],
    );
    expect((await db.getAll('accounts')).map((a) => a.id).sort()).toEqual(['a1', 'a2']);
    expect((await db.get('accounts', 'a1'))?.initialBalance).toBe('1500000');
    expect((await db.getAll('transactions')).map((t) => t.id).sort()).toEqual(['t1', 't2']);
    expect((await db.get('scheduledExpenses', 's1'))?.amount).toBe('900000');
    expect((await db.get('meta', 'lastBackupAt'))?.value).toBe('2026-03-01T00:00:00.000Z');
    expect(await db.getAll('scheduledIncomes')).toEqual([]);
    expect(await db.getAll('creditCards')).toEqual([]);
    expect(await db.getAll('cardPurchases')).toEqual([]);
  });

  it('los índices antiguos siguen funcionando', async () => {
    await createV1(name);
    const db = await openV2();
    expect((await db.getAllFromIndex('transactions', 'by-date')).map((t) => t.id)).toEqual(['t1', 't2']);
    const byAccount = await db.getAllFromIndex('transactions', 'by-account-date', IDBKeyRange.bound('a2|', 'a2|￿'));
    expect(byAccount.map((t) => t.id)).toEqual(['t2']);
    expect((await db.getAllFromIndex('scheduledExpenses', 'by-account', 'a1')).map((s) => s.id)).toEqual(['s1']);
  });

  it('los almacenes nuevos son utilizables y tienen sus índices', async () => {
    await createV1(name);
    const db = await openV2();
    const income = { id: 'i1', description: 'Nómina', amount: '2000000', currency: 'COP', accountId: 'a1', frequency: 'MONTHLY', startDate: '2026-04-30', endDate: null, settledThrough: null };
    await db.put('scheduledIncomes', income);
    expect(await db.getAllFromIndex('scheduledIncomes', 'by-account', 'a1')).toEqual([income]);
    const card = { id: 'c1', name: 'Visa', dueDay: 15, paymentAccountId: 'a1', feeKind: 'NONE' as const, feeAmount: null, currency: 'COP', rateBasis: null, ratePpm: null, feeStartMonth: '2026-03', feesSettledThrough: null };
    await db.put('creditCards', card);
    expect(await db.get('creditCards', 'c1')).toEqual(card);
    const purchase = { id: 'p1', cardId: 'c1', description: 'TV', category: null, amount: '1200000', currency: 'COP', installments: 12, purchaseDate: '2026-03-01', firstDueDate: '2026-04-15', monthlyRatePpm: 20000, paidInstallments: 0, closedOn: null };
    await db.put('cardPurchases', purchase);
    expect(await db.getAllFromIndex('cardPurchases', 'by-card', 'c1')).toEqual([purchase]);
  });

  it('los repositorios y readAll siguen igual tras actualizar', async () => {
    await createV1(name);
    const db = await openV2();
    const accounts = new IdbAccountRepository(db);
    const txs = new IdbTransactionRepository(db);
    const sched = new IdbScheduledExpenseRepository(db);
    const ledger = new IdbLedgerStore(db);
    expect((await accounts.findById('a1'))?.name).toBe('Bancolombia');
    await accounts.save(Account.create({ id: 'a3', name: 'Nu', type: 'DIGITAL', initialBalance: cop(10) }));
    await txs.save(TransactionFactory.create({ type: 'EXPENSE', id: 't3', accountId: 'a3', amount: cop(1), date: new Date('2026-03-03T00:00:00Z'), description: 'x' }));
    await sched.save(ScheduledExpense.create({ id: 's2', description: 'Luz', amount: cop(100), accountId: 'a3', frequency: 'MONTHLY', startDate: new Date('2026-05-01T00:00:00Z') }));
    const snap = await ledger.readAll();
    expect(Object.keys(snap).sort()).toEqual(['accounts', 'scheduledExpenses', 'transactions']);
    expect(snap.accounts.map((a) => a.id).sort()).toEqual(['a1', 'a2', 'a3']);
    expect(snap.transactions.map((t) => t.id).sort()).toEqual(['t1', 't2', 't3']);
    expect(snap.scheduledExpenses.map((s) => s.id).sort()).toEqual(['s1', 's2']);
  });

  it('una base nueva desde cero tiene todo, y reabrir v2 no cambia nada', async () => {
    const first = await openV2();
    expect([...first.objectStoreNames]).toHaveLength(7);
    expect([...first.transaction('cardPurchases').store.indexNames]).toEqual(['by-card']);
    await first.put('accounts', { id: 'z', name: 'Z', type: 'CASH', initialBalance: '1', currency: 'COP' });
    await first.put('creditCards', { id: 'c', name: 'V', dueDay: 1, paymentAccountId: 'z', feeKind: 'NONE', feeAmount: null, currency: 'COP', rateBasis: null, ratePpm: null, feeStartMonth: '2026-01', feesSettledThrough: null });
    first.close();
    open.pop();
    const again = await openV2();
    expect(again.version).toBe(2);
    expect((await again.getAll('accounts')).map((a) => a.id)).toEqual(['z']);
    expect((await again.getAll('creditCards')).map((c) => c.id)).toEqual(['c']);
  });
});

describe('otras pestañas abiertas', () => {
  it('avisa con onBlocked mientras una conexión vieja sigue abierta y termina cuando se cierra', async () => {
    const old = await openDB(name, 1, { upgrade: (d) => void d.createObjectStore('accounts', { keyPath: 'id' }) });
    const onBlocked = vi.fn();
    const pending = openFinanzasDb(name, { onBlocked });
    await vi.waitFor(() => expect(onBlocked).toHaveBeenCalled());
    old.close();
    const db = await pending;
    open.push(db);
    expect(db.version).toBe(2);
  });

  it('cierra su conexión cuando otra pestaña pide actualizar (blocking)', async () => {
    const db = await openV2();
    const next = await openDB(name, 3, { blocked: () => { throw new Error('quedó bloqueada'); } });
    next.close();
    expect(() => db.transaction('accounts')).toThrow();
  });
});
