import { Account } from '../account/account';
import { ScheduledExpense } from '../scheduled/scheduled-expense';
import { ScheduledIncome } from '../scheduled/scheduled-income';
import { Transaction } from '../transaction/transaction';

/** Puertos de persistencia: el dominio define el contrato, la infraestructura lo implementa. */
export interface AccountRepository {
  findAll(): Promise<Account[]>;
  findById(id: string): Promise<Account | null>;
  save(account: Account): Promise<void>;
}

export interface TransactionQuery {
  accountId?: string;
  from?: Date;
  to?: Date;
}

/** Posición keyset: el historial se ordena por (date DESC, id ASC) y se reanuda tras esta clave. */
export interface TransactionCursor {
  date: Date;
  id: string;
}

export interface TransactionPageQuery {
  accountId?: string;
  limit: number;
  after?: TransactionCursor;
  /** Solo movimientos de ese mes ('YYYY-MM', sobre la fecha ISO). */
  month?: string;
  /** Solo gastos de esa categoría (clave ya normalizada; ver normalizeCategory). */
  categoryKey?: string;
  /** Hasta ese día inclusive ('YYYY-MM-DD'); sirve para no contar gastos con fecha futura. */
  until?: string;
}

export interface TransactionRepository {
  findAll(query?: TransactionQuery): Promise<Transaction[]>;
  findById(id: string): Promise<Transaction | null>;
  /** Página keyset (sin OFFSET) ordenada por (date DESC, id ASC), igual que el índice. */
  findPage(query: TransactionPageQuery): Promise<Transaction[]>;
  /** Variación neta por cuenta, agregada en la base de datos (SUM ... GROUP BY). */
  balanceDeltas(): Promise<Map<string, bigint>>;
  save(transaction: Transaction): Promise<void>;
  saveMany(transactions: readonly Transaction[]): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface ScheduledExpenseRepository {
  findAll(): Promise<ScheduledExpense[]>;
  findById(id: string): Promise<ScheduledExpense | null>;
  save(expense: ScheduledExpense): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface ScheduledIncomeRepository {
  findAll(): Promise<ScheduledIncome[]>;
  findById(id: string): Promise<ScheduledIncome | null>;
  save(income: ScheduledIncome): Promise<void>;
  delete(id: string): Promise<void>;
}

export const ACCOUNT_REPOSITORY = Symbol('AccountRepository');
export const TRANSACTION_REPOSITORY = Symbol('TransactionRepository');
export const SCHEDULED_EXPENSE_REPOSITORY = Symbol('ScheduledExpenseRepository');
