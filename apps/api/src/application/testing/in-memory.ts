import {
  Account,
  AccountRepository,
  ScheduledExpense,
  ScheduledExpenseRepository,
  Transaction,
  TransactionPageQuery,
  TransactionQuery,
  TransactionRepository,
} from '@finanzas/domain';
import { Clock } from '../ports/clock.port';
import { TransactionalRepositories, UnitOfWork } from '../ports/unit-of-work.port';

/** Dobles en memoria de los puertos, solo para pruebas unitarias. */
export class InMemoryAccountRepository implements AccountRepository {
  readonly items = new Map<string, Account>();
  findAllCalls = 0;

  async findAll(): Promise<Account[]> {
    this.findAllCalls += 1;
    return [...this.items.values()];
  }
  async findById(id: string): Promise<Account | null> {
    return this.items.get(id) ?? null;
  }
  async save(account: Account): Promise<void> {
    this.items.set(account.id, account);
  }
}

export class InMemoryTransactionRepository implements TransactionRepository {
  readonly items = new Map<string, Transaction>();
  balanceDeltasCalls = 0;

  async findAll(query: TransactionQuery = {}): Promise<Transaction[]> {
    return [...this.items.values()].filter((t) => !query.accountId || t.accountIds().includes(query.accountId));
  }
  async findById(id: string): Promise<Transaction | null> {
    return this.items.get(id) ?? null;
  }
  async findPage({ accountId, limit, after }: TransactionPageQuery): Promise<Transaction[]> {
    return [...this.items.values()]
      .filter((t) => !accountId || t.accountIds().includes(accountId))
      .sort((a, b) => b.date.getTime() - a.date.getTime() || (a.id < b.id ? -1 : 1))
      .filter((t) => {
        if (!after) return true;
        const diff = t.date.getTime() - after.date.getTime();
        return diff < 0 || (diff === 0 && t.id > after.id);
      })
      .slice(0, limit);
  }
  async balanceDeltas(): Promise<Map<string, bigint>> {
    this.balanceDeltasCalls += 1;
    const totals = new Map<string, bigint>();
    for (const tx of this.items.values()) {
      for (const { accountId, delta } of tx.effects()) {
        totals.set(accountId, (totals.get(accountId) ?? 0n) + delta.amount);
      }
    }
    return totals;
  }
  async save(transaction: Transaction): Promise<void> {
    this.items.set(transaction.id, transaction);
  }
  async saveMany(transactions: readonly Transaction[]): Promise<void> {
    for (const t of transactions) this.items.set(t.id, t);
  }
  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }
}

export class InMemoryScheduledExpenseRepository implements ScheduledExpenseRepository {
  readonly items = new Map<string, ScheduledExpense>();

  async findAll(): Promise<ScheduledExpense[]> {
    return [...this.items.values()];
  }
  async findById(id: string): Promise<ScheduledExpense | null> {
    return this.items.get(id) ?? null;
  }
  async save(expense: ScheduledExpense): Promise<void> {
    this.items.set(expense.id, expense);
  }
  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }
}

export class InMemoryUnitOfWork implements UnitOfWork {
  constructor(private readonly repositories: TransactionalRepositories) {}
  run<T>(work: (repositories: TransactionalRepositories) => Promise<T>): Promise<T> {
    return work(this.repositories);
  }
}

export function createInMemoryRepositories() {
  const accounts = new InMemoryAccountRepository();
  const transactions = new InMemoryTransactionRepository();
  const scheduledExpenses = new InMemoryScheduledExpenseRepository();
  return { accounts, transactions, scheduledExpenses, unitOfWork: new InMemoryUnitOfWork({ accounts, transactions, scheduledExpenses }) };
}

export class FixedClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return this.current;
  }
  set(date: Date): void {
    this.current = date;
  }
}
