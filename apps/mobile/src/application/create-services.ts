import type { FinanzasDb } from '@/data/database';
import { IdbAccountRepository } from '@/data/idb-account.repository';
import { IdbLedgerStore } from '@/data/idb-ledger-store';
import { IdbScheduledExpenseRepository } from '@/data/idb-scheduled-expense.repository';
import { IdbTransactionRepository } from '@/data/idb-transaction.repository';
import { AccountService } from './account-service';
import { ChangeBus } from './change-bus';
import { ScheduledService } from './scheduled-service';
import { SummaryService } from './summary-service';
import type { ServiceContext } from './support';
import { TransactionService } from './transaction-service';

export interface CreateServicesOptions {
  db: FinanzasDb;
  now?: () => Date;
  newId?: () => string;
}

export interface AppServices {
  accounts: AccountService;
  transactions: TransactionService;
  scheduled: ScheduledService;
  summary: SummaryService;
  bus: ChangeBus;
}

/** Raíz de composición: conecta los adaptadores IndexedDB con los casos de uso. */
export function createServices({ db, now = () => new Date(), newId = () => crypto.randomUUID() }: CreateServicesOptions): AppServices {
  const bus = new ChangeBus();
  const ctx: ServiceContext = {
    accounts: new IdbAccountRepository(db),
    transactions: new IdbTransactionRepository(db),
    scheduled: new IdbScheduledExpenseRepository(db),
    ledger: new IdbLedgerStore(db),
    bus,
    now,
    newId,
  };
  return {
    accounts: new AccountService(ctx),
    transactions: new TransactionService(ctx),
    scheduled: new ScheduledService(ctx),
    summary: new SummaryService(ctx),
    bus,
  };
}
