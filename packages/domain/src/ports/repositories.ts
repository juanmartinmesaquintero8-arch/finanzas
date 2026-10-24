import { Account } from '../account/account';
import { ScheduledExpense } from '../scheduled/scheduled-expense';
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

export const ACCOUNT_REPOSITORY = Symbol('AccountRepository');
export const TRANSACTION_REPOSITORY = Symbol('TransactionRepository');
export const SCHEDULED_EXPENSE_REPOSITORY = Symbol('ScheduledExpenseRepository');
