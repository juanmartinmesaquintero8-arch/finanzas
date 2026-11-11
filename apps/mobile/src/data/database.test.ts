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

const openCurrent = async (n = name) => {
  const db = await openFinanzasDb(n);
  open.push(db);
  return db;
};

describe('actualización v1 -> v3 (directa)', () => {
  it('DB_VERSION es 3', () => {
    expect(DB_VERSION).toBe(3);
  });

  it('conserva intactos los datos reales de una base v1 y deja los almacenes nuevos vacíos', async () => {
    await createV1(name);
    const db = await openCurrent();
    expect(db.version).toBe(3);
    expect([...db.objectStoreNames].sort()).toEqual(
      ['accounts', 'cardPayments', 'cardPurchases', 'creditCards', 'meta', 'scheduledExpenses', 'scheduledIncomes', 'transactions'],
    );
    expect((await db.getAll('accounts')).map((a) => a.id).sort()).toEqual(['a1', 'a2']);
    expect((await db.get('accounts', 'a1'))?.initialBalance).toBe('1500000');
    expect((await db.getAll('transactions')).map((t) => t.id).sort()).toEqual(['t1', 't2']);
    expect((await db.get('scheduledExpenses', 's1'))?.amount).toBe('900000');
    expect((await db.get('meta', 'lastBackupAt'))?.value).toBe('2026-03-01T00:00:00.000Z');
    expect(await db.getAll('scheduledIncomes')).toEqual([]);
    expect(await db.getAll('creditCards')).toEqual([]);
    expect(await db.getAll('cardPurchases')).toEqual([]);
    expect(await db.getAll('cardPayments')).toEqual([]);
  });

  it('los índices antiguos siguen funcionando', async () => {
    await createV1(name);
    const db = await openCurrent();
    expect((await db.getAllFromIndex('transactions', 'by-date')).map((t) => t.id)).toEqual(['t1', 't2']);
    const byAccount = await db.getAllFromIndex('transactions', 'by-account-date', IDBKeyRange.bound('a2|', 'a2|￿'));
    expect(byAccount.map((t) => t.id)).toEqual(['t2']);
    expect((await db.getAllFromIndex('scheduledExpenses', 'by-account', 'a1')).map((s) => s.id)).toEqual(['s1']);
  });

  it('los almacenes nuevos son utilizables y tienen sus índices', async () => {
    await createV1(name);
    const db = await openCurrent();
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
    const db = await openCurrent();
    const accounts = new IdbAccountRepository(db);
    const txs = new IdbTransactionRepository(db);
    const sched = new IdbScheduledExpenseRepository(db);
    const ledger = new IdbLedgerStore(db);
    expect((await accounts.findById('a1'))?.name).toBe('Bancolombia');
    await accounts.save(Account.create({ id: 'a3', name: 'Nu', type: 'DIGITAL', initialBalance: cop(10) }));
    await txs.save(TransactionFactory.create({ type: 'EXPENSE', id: 't3', accountId: 'a3', amount: cop(1), date: new Date('2026-03-03T00:00:00Z'), description: 'x' }));
    await sched.save(ScheduledExpense.create({ id: 's2', description: 'Luz', amount: cop(100), accountId: 'a3', frequency: 'MONTHLY', startDate: new Date('2026-05-01T00:00:00Z') }));
    const snap = await ledger.readAll();
    expect(Object.keys(snap).sort()).toEqual(['accounts', 'cardPayments', 'cardPurchases', 'creditCards', 'scheduledExpenses', 'scheduledIncomes', 'transactions']);
    expect(snap.accounts.map((a) => a.id).sort()).toEqual(['a1', 'a2', 'a3']);
    expect(snap.transactions.map((t) => t.id).sort()).toEqual(['t1', 't2', 't3']);
    expect(snap.scheduledExpenses.map((s) => s.id).sort()).toEqual(['s1', 's2']);
  });

  it('una base nueva desde cero tiene todo, y reabrir v3 no cambia nada', async () => {
    const first = await openCurrent();
    expect([...first.objectStoreNames]).toHaveLength(8);
    expect([...first.transaction('cardPayments').store.indexNames]).toEqual(['by-card']);
    expect([...first.transaction('cardPurchases').store.indexNames]).toEqual(['by-card']);
    await first.put('accounts', { id: 'z', name: 'Z', type: 'CASH', initialBalance: '1', currency: 'COP' });
    await first.put('creditCards', { id: 'c', name: 'V', dueDay: 1, paymentAccountId: 'z', feeKind: 'NONE', feeAmount: null, currency: 'COP', rateBasis: null, ratePpm: null, feeStartMonth: '2026-01', feesSettledThrough: null });
    first.close();
    open.pop();
    const again = await openCurrent();
    expect(again.version).toBe(3);
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
    expect(db.version).toBe(3);
  });

  it('cierra su conexión cuando otra pestaña pide actualizar (blocking)', async () => {
    const db = await openCurrent();
    const next = await openDB(name, 4, { blocked: () => { throw new Error('quedó bloqueada'); } });
    next.close();
    expect(() => db.transaction('accounts')).toThrow();
  });
});

/** Esquema v2 copiado LITERALMENTE de la versión con tarjetas (no se importa), con tarjetas, compras y pagos de hoy. */
async function createV2(dbName: string) {
  const db = await openDB(dbName, 2, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) {
        d.createObjectStore('accounts', { keyPath: 'id' });
        const transactions = d.createObjectStore('transactions', { keyPath: 'id' });
        transactions.createIndex('by-date', 'date');
        transactions.createIndex('by-account-date', 'accountDates', { multiEntry: true });
        d.createObjectStore('scheduledExpenses', { keyPath: 'id' }).createIndex('by-account', 'accountId');
        d.createObjectStore('meta', { keyPath: 'key' });
      }
      d.createObjectStore('scheduledIncomes', { keyPath: 'id' }).createIndex('by-account', 'accountId');
      d.createObjectStore('creditCards', { keyPath: 'id' });
      d.createObjectStore('cardPurchases', { keyPath: 'id' }).createIndex('by-card', 'cardId');
    },
  });
  await db.put('accounts', { id: 'a1', name: 'Bancolombia', type: 'BANK', initialBalance: '1500000', currency: 'COP' });
  await db.put('creditCards', V2_CARD);
  await db.put('cardPurchases', V2_PURCHASE);
  await db.put('transactions', V2_PAYMENT);
  await db.put('meta', { key: 'lastBackupAt', value: '2026-03-01T00:00:00.000Z' });
  db.close();
}
const V2_CARD = {
  id: 'c1', name: 'Visa', dueDay: 15, cutDay: 30, paymentAccountId: 'a1', feeKind: 'FIXED_MONTHLY', feeAmount: '18000', currency: 'COP',
  rateBasis: 'MV', ratePpm: 20000, feeStartMonth: '2026-01', feesSettledThrough: '2026-02',
};
const V2_PURCHASE = {
  id: 'p1', cardId: 'c1', description: 'Nevera', category: 'Hogar', amount: '1200000', currency: 'COP', installments: 12,
  purchaseDate: '2026-01-10T00:00:00.000Z', firstDueDate: '2026-02-15T00:00:00.000Z', monthlyRatePpm: 20000, paidInstallments: 2, closedOn: null, dueDayAnchor: 15,
};
const V2_PAYMENT = {
  id: 'cp-p1-2', type: 'EXPENSE', amount: '100000', currency: 'COP', date: '2026-03-15T00:00:00.000Z', description: 'Nevera (cuota 2/12)',
  category: 'Hogar', accountId: 'a1', fromAccountId: null, toAccountId: null, accountDates: ['a1|2026-03-15T00:00:00.000Z'],
};

describe('actualización v2 -> v3', () => {
  it('conserva intactas tarjetas, compras y pagos de hoy y deja los pagos nuevos vacíos', async () => {
    await createV2(name);
    const db = await openCurrent();
    expect(db.version).toBe(3);
    expect(await db.get('creditCards', 'c1')).toEqual(V2_CARD);
    expect(await db.get('cardPurchases', 'p1')).toEqual(V2_PURCHASE);
    expect(await db.get('transactions', 'cp-p1-2')).toEqual(V2_PAYMENT);
    expect((await db.get('meta', 'lastBackupAt'))?.value).toBe('2026-03-01T00:00:00.000Z');
    expect(await db.getAll('cardPayments')).toEqual([]);
    expect((await db.getAllFromIndex('cardPurchases', 'by-card', 'c1')).map((p) => p.id)).toEqual(['p1']);
    expect((await new IdbLedgerStore(db).readAll()).cardPurchases[0]!.paidInstallments).toBe(2);
  });

  it('el almacén nuevo ordena los pagos por tarjeta y orden, y no admite dos con el mismo orden', async () => {
    await createV2(name);
    const db = await openCurrent();
    const index = db.transaction('cardPayments').store.index('by-card');
    expect(index.keyPath).toEqual(['cardId', 'seq']);
    expect(index.unique).toBe(true);
  });
});
