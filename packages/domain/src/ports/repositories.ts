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

export interface TransactionRepository {
  findAll(query?: TransactionQuery): Promise<Transaction[]>;
  save(transaction: Transaction): Promise<void>;
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
