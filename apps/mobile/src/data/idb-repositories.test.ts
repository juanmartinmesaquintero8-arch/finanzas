import { Account, Money, ScheduledExpense, TransactionFactory, type Transaction } from '@finanzas/domain';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openFinanzasDb, type FinanzasDb } from './database';
import { IdbAccountRepository } from './idb-account.repository';
import { IdbLedgerStore } from './idb-ledger-store';
import { IdbScheduledExpenseRepository } from './idb-scheduled-expense.repository';
import { IdbTransactionRepository } from './idb-transaction.repository';

const cop = (n: bigint | number) => Money.of(n, 'COP');
let dbName = '';
let db: FinanzasDb;
let counter = 0;

beforeEach(async () => {
  dbName = `test-${++counter}-${Math.random()}`;
  db = await openFinanzasDb(dbName);
});
afterEach(async () => {
  db.close();
  await deleteDB(dbName);
});

const account = (id: string, balance: bigint | number = 0) =>
  Account.create({ id, name: `Cuenta ${id}`, type: 'BANK', initialBalance: cop(balance) });

const expense = (id: string, accountId: string, date: string, amount: bigint | number = 1000, extra = {}): Transaction =>
  TransactionFactory.create({ type: 'EXPENSE', id, accountId, amount: cop(amount), date: new Date(date), description: `gasto ${id}`, ...extra });

describe('IdbAccountRepository', () => {
  it('guarda, busca por id y lista cuentas', async () => {
    const repo = new IdbAccountRepository(db);
    await repo.save(account('a', 5000));
    await repo.save(account('b'));
    expect((await repo.findById('a'))?.name).toBe('Cuenta a');
    expect((await repo.findById('a'))?.initialBalance.amount).toBe(5000n);
    expect(await repo.findById('zzz')).toBeNull();
    expect((await repo.findAll()).map((a) => a.id).sort()).toEqual(['a', 'b']);
  });

  it('guarda el monto como string (bigint seguro) y respeta saldos enormes', async () => {
    const repo = new IdbAccountRepository(db);
    const huge = 9_007_199_254_740_993n; // > Number.MAX_SAFE_INTEGER
    await repo.save(account('a', huge));
    const raw = await db.get('accounts', 'a');
    expect(typeof raw?.initialBalance).toBe('string');
    expect((await repo.findById('a'))?.initialBalance.amount).toBe(huge);
  });

  it('save actualiza una cuenta existente', async () => {
    const repo = new IdbAccountRepository(db);
    await repo.save(account('a', 1));
    await repo.save(Account.create({ id: 'a', name: 'Renombrada', type: 'CASH', initialBalance: cop(9) }));
    const found = await repo.findById('a');
    expect([found?.name, found?.type, found?.initialBalance.amount]).toEqual(['Renombrada', 'CASH', 9n]);
    expect(await repo.findAll()).toHaveLength(1);
  });

  it('elimina una cuenta', async () => {
    const repo = new IdbAccountRepository(db);
    await repo.save(account('a'));
    await repo.delete('a');
    expect(await repo.findAll()).toEqual([]);
  });
});

describe('IdbTransactionRepository', () => {
  it('hace round-trip de ingreso, gasto y transferencia', async () => {
    const repo = new IdbTransactionRepository(db);
    await repo.saveMany([
      TransactionFactory.create({ type: 'INCOME', id: 'i', accountId: 'a', amount: cop(100), date: new Date('2026-03-01T00:00:00Z'), description: 'Salario', category: 'Trabajo' }),
      expense('e', 'a', '2026-03-02T00:00:00Z', 40),
      TransactionFactory.create({ type: 'TRANSFER', id: 't', fromAccountId: 'a', toAccountId: 'b', amount: cop(10), date: new Date('2026-03-03T00:00:00Z'), description: 'Pasar' }),
    ]);
    const i = await repo.findById('i');
    expect(i).toMatchObject({ type: 'INCOME', accountId: 'a', description: 'Salario', category: 'Trabajo' });
    expect(i?.amount.amount).toBe(100n);
    expect(i?.date.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(await repo.findById('t')).toMatchObject({ type: 'TRANSFER', fromAccountId: 'a', toAccountId: 'b' });
    expect((await repo.findById('e'))?.category).toBeUndefined();
    expect(await repo.findById('nope')).toBeNull();
  });

  it('guarda el monto como string', async () => {
    const repo = new IdbTransactionRepository(db);
    await repo.save(expense('e', 'a', '2026-03-02T00:00:00Z', 9_007_199_254_740_993n));
    expect(typeof (await db.get('transactions', 'e'))?.amount).toBe('string');
    expect((await repo.findById('e'))?.amount.amount).toBe(9_007_199_254_740_993n);
  });

  it('save reemplaza (edición) y cambia el tipo sin dejar rastros', async () => {
    const repo = new IdbTransactionRepository(db);
    await repo.save(expense('x', 'a', '2026-03-02T00:00:00Z', 40));
    await repo.save(
      TransactionFactory.create({ type: 'TRANSFER', id: 'x', fromAccountId: 'a', toAccountId: 'b', amount: cop(7), date: new Date('2026-03-04T00:00:00Z'), description: 'ahora transferencia' }),
    );
    expect(await repo.findAll()).toHaveLength(1);
    const found = await repo.findById('x');
    expect(found).toMatchObject({ type: 'TRANSFER', toAccountId: 'b' });
    expect((await repo.findPage({ accountId: 'b', limit: 10 })).map((t) => t.id)).toEqual(['x']);
  });

  it('delete elimina y deja de aparecer en historial y saldos', async () => {
    const repo = new IdbTransactionRepository(db);
    await repo.saveMany([expense('1', 'a', '2026-03-01T00:00:00Z', 10), expense('2', 'a', '2026-03-02T00:00:00Z', 20)]);
    await repo.delete('1');
    expect(await repo.findById('1')).toBeNull();
    expect((await repo.balanceDeltas()).get('a')).toBe(-20n);
  });

  it('findAll filtra por cuenta (incluye ambos lados de una transferencia) y por rango de fechas', async () => {
    const repo = new IdbTransactionRepository(db);
    await repo.saveMany([
      expense('1', 'a', '2026-03-01T00:00:00Z'),
      expense('2', 'b', '2026-03-05T00:00:00Z'),
      TransactionFactory.create({ type: 'TRANSFER', id: '3', fromAccountId: 'a', toAccountId: 'b', amount: cop(5), date: new Date('2026-03-10T00:00:00Z'), description: 't' }),
    ]);
    expect((await repo.findAll({ accountId: 'b' })).map((t) => t.id).sort()).toEqual(['2', '3']);
    expect((await repo.findAll({ from: new Date('2026-03-02T00:00:00Z'), to: new Date('2026-03-06T00:00:00Z') })).map((t) => t.id)).toEqual(['2']);
    expect(await repo.findAll()).toHaveLength(3);
  });

  describe('findPage (keyset por fecha e id)', () => {
    const seed = async (repo: IdbTransactionRepository) => {
      await repo.saveMany([
        expense('a1', 'a', '2026-03-01T00:00:00Z'),
        expense('b2', 'a', '2026-03-05T00:00:00Z'),
        expense('a2', 'a', '2026-03-05T00:00:00Z'), // empata fecha con b2
        expense('c3', 'b', '2026-03-07T00:00:00Z'),
        TransactionFactory.create({ type: 'TRANSFER', id: 'd4', fromAccountId: 'b', toAccountId: 'a', amount: cop(1), date: new Date('2026-03-09T00:00:00Z'), description: 't' }),
      ]);
    };

    it('ordena por fecha descendente y, en empate, por id ascendente', async () => {
      const repo = new IdbTransactionRepository(db);
      await seed(repo);
      expect((await repo.findPage({ limit: 10 })).map((t) => t.id)).toEqual(['d4', 'c3', 'a2', 'b2', 'a1']);
    });

    it('recorre todas las páginas con el cursor sin repetir ni saltar (incluso con fechas empatadas)', async () => {
      const repo = new IdbTransactionRepository(db);
      await seed(repo);
      const seen: string[] = [];
      let after: { date: Date; id: string } | undefined;
      for (let guard = 0; guard < 10; guard++) {
        const page = await repo.findPage({ limit: 2, after });
        if (page.length === 0) break;
        seen.push(...page.map((t) => t.id));
        const last = page[page.length - 1]!;
        after = { date: last.date, id: last.id };
      }
      expect(seen).toEqual(['d4', 'c3', 'a2', 'b2', 'a1']);
    });

    it('un cursor en medio de un empate continúa con el siguiente id', async () => {
      const repo = new IdbTransactionRepository(db);
      await seed(repo);
      const page = await repo.findPage({ limit: 10, after: { date: new Date('2026-03-05T00:00:00Z'), id: 'a2' } });
      expect(page.map((t) => t.id)).toEqual(['b2', 'a1']);
    });

    it('filtra por cuenta e incluye transferencias donde participa', async () => {
      const repo = new IdbTransactionRepository(db);
      await seed(repo);
      expect((await repo.findPage({ accountId: 'b', limit: 10 })).map((t) => t.id)).toEqual(['d4', 'c3']);
      expect((await repo.findPage({ accountId: 'a', limit: 10 })).map((t) => t.id)).toEqual(['d4', 'a2', 'b2', 'a1']);
      const second = await repo.findPage({ accountId: 'a', limit: 2, after: { date: new Date('2026-03-09T00:00:00Z'), id: 'd4' } });
      expect(second.map((t) => t.id)).toEqual(['a2', 'b2']);
    });

    it('respeta el límite', async () => {
      const repo = new IdbTransactionRepository(db);
      await seed(repo);
      expect(await repo.findPage({ limit: 3 })).toHaveLength(3);
    });
  });

  describe('balanceDeltas (totales por cuenta)', () => {
    it('suma ingresos, resta gastos y mueve dinero en transferencias', async () => {
      const repo = new IdbTransactionRepository(db);
      await repo.saveMany([
        TransactionFactory.create({ type: 'INCOME', id: 'i', accountId: 'a', amount: cop(1000), date: new Date('2026-03-01T00:00:00Z'), description: 'i' }),
        expense('e', 'a', '2026-03-02T00:00:00Z', 300),
        TransactionFactory.create({ type: 'TRANSFER', id: 't', fromAccountId: 'a', toAccountId: 'b', amount: cop(200), date: new Date('2026-03-03T00:00:00Z'), description: 't' }),
      ]);
      const deltas = await repo.balanceDeltas();
      expect(deltas.get('a')).toBe(500n);
      expect(deltas.get('b')).toBe(200n);
    });

    it('es exacto con montos mayores a 2^53', async () => {
      const repo = new IdbTransactionRepository(db);
      await repo.saveMany([expense('1', 'a', '2026-03-01T00:00:00Z', 9_007_199_254_740_993n), expense('2', 'a', '2026-03-02T00:00:00Z', 1n)]);
      expect((await repo.balanceDeltas()).get('a')).toBe(-9_007_199_254_740_994n);
    });

    it('sin movimientos devuelve un mapa vacío', async () => {
      expect((await new IdbTransactionRepository(db).balanceDeltas()).size).toBe(0);
    });
  });
});

describe('IdbScheduledExpenseRepository', () => {
  const rent = (over: Partial<Parameters<typeof ScheduledExpense.create>[0]> = {}) =>
    ScheduledExpense.create({ id: 's1', description: 'Arriendo', amount: cop(900000), accountId: 'a', frequency: 'MONTHLY', startDate: new Date('2026-03-05T00:00:00Z'), ...over });

  it('CRUD con endDate y settledThrough', async () => {
    const repo = new IdbScheduledExpenseRepository(db);
    await repo.save(rent({ endDate: new Date('2026-12-05T00:00:00Z'), settledThrough: new Date('2026-03-05T00:00:00Z') }));
    const found = await repo.findById('s1');
    expect(found).toMatchObject({ description: 'Arriendo', frequency: 'MONTHLY', accountId: 'a' });
    expect(found?.amount.amount).toBe(900000n);
    expect(found?.endDate?.toISOString()).toBe('2026-12-05T00:00:00.000Z');
    expect(found?.settledThrough?.toISOString()).toBe('2026-03-05T00:00:00.000Z');
    expect(typeof (await db.get('scheduledExpenses', 's1'))?.amount).toBe('string');

    await repo.save(rent({ description: 'Arriendo nuevo' }));
    expect((await repo.findById('s1'))?.description).toBe('Arriendo nuevo');
    expect((await repo.findById('s1'))?.endDate).toBeUndefined();
    expect(await repo.findAll()).toHaveLength(1);

    await repo.delete('s1');
    expect(await repo.findById('s1')).toBeNull();
  });
});

describe('IdbLedgerStore', () => {
  const store = () => new IdbLedgerStore(db);
  const sched = (id: string) =>
    ScheduledExpense.create({ id, description: 'Arriendo', amount: cop(100), accountId: 'a', frequency: 'ONCE', startDate: new Date('2026-03-05T00:00:00Z') });

  it('settle guarda gastos reales y marca el programado en una sola operación', async () => {
    const s = sched('s1');
    await new IdbScheduledExpenseRepository(db).save(s);
    await store().settle(s.markSettled(new Date('2026-03-05T00:00:00Z')), [expense('r1', 'a', '2026-03-05T00:00:00Z', 100)]);
    expect((await new IdbTransactionRepository(db).findById('r1'))?.amount.amount).toBe(100n);
    expect((await new IdbScheduledExpenseRepository(db).findById('s1'))?.settledThrough).toBeDefined();
  });

  it('settle es atómico: si algo falla no se escribe nada', async () => {
    const s = sched('s1');
    await new IdbScheduledExpenseRepository(db).save(s);
    const bad = { ...expense('r1', 'a', '2026-03-05T00:00:00Z', 100), id: undefined } as unknown as Transaction; // clave inválida
    await expect(store().settle(s.markSettled(new Date('2026-03-05T00:00:00Z')), [expense('ok', 'a', '2026-03-05T00:00:00Z'), bad])).rejects.toBeDefined();
    expect(await new IdbTransactionRepository(db).findAll()).toEqual([]);
    expect((await new IdbScheduledExpenseRepository(db).findById('s1'))?.settledThrough).toBeUndefined();
  });

  it('readAll / replaceAll / clearAll', async () => {
    await store().replaceAll({
      accounts: [account('a', 10)],
      transactions: [expense('e', 'a', '2026-03-02T00:00:00Z')],
      scheduledExpenses: [sched('s1')],
    });
    const all = await store().readAll();
    expect([all.accounts.length, all.transactions.length, all.scheduledExpenses.length]).toEqual([1, 1, 1]);

    await store().replaceAll({ accounts: [account('z')], transactions: [], scheduledExpenses: [] });
    const after = await store().readAll();
    expect(after.accounts.map((a) => a.id)).toEqual(['z']);
    expect(after.transactions).toEqual([]);

    await store().clearAll();
    expect((await store().readAll()).accounts).toEqual([]);
  });

  it('meta: guarda y lee valores simples', async () => {
    expect(await store().getMeta('lastBackupAt')).toBeUndefined();
    await store().setMeta('lastBackupAt', '2026-03-01T00:00:00.000Z');
    expect(await store().getMeta('lastBackupAt')).toBe('2026-03-01T00:00:00.000Z');
  });

  it('clearAll conserva el aviso de copia (meta) pero borra los datos', async () => {
    await store().setMeta('lastBackupAt', 'x');
    await store().replaceAll({ accounts: [account('a')], transactions: [], scheduledExpenses: [] });
    await store().clearAll();
    expect(await store().getMeta('lastBackupAt')).toBe('x');
  });
});
