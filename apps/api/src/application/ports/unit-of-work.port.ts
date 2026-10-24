import { AccountRepository, ScheduledExpenseRepository, TransactionRepository } from '@finanzas/domain';

export interface TransactionalRepositories {
  accounts: AccountRepository;
  transactions: TransactionRepository;
  scheduledExpenses: ScheduledExpenseRepository;
}

/** Unidad de trabajo: ejecuta varias escrituras de forma atómica (una transacción de BD). */
export interface UnitOfWork {
  run<T>(work: (repositories: TransactionalRepositories) => Promise<T>): Promise<T>;
}

export const UNIT_OF_WORK = Symbol('UnitOfWork');
