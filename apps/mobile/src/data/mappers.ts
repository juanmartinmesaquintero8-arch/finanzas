import {
  ACCOUNT_TYPES,
  Account,
  FREQUENCIES,
  Money,
  ScheduledExpense,
  TransactionFactory,
  type AccountType,
  type Frequency,
  type Transaction,
} from '@finanzas/domain';
import type { StoredAccount, StoredScheduledExpense, StoredTransaction } from './database';

/** Separador de la clave compuesta `cuenta|fecha`. */
const KEY_SEP = '|';

export const accountDateKey = (accountId: string, isoDate: string): string => `${accountId}${KEY_SEP}${isoDate}`;
export const accountDateRange = (accountId: string): { lower: string; upper: string } => ({
  lower: `${accountId}${KEY_SEP}`,
  upper: `${accountId}${KEY_SEP}￿`,
});

export function toStoredAccount(a: Account): StoredAccount {
  return { id: a.id, name: a.name, type: a.type, initialBalance: a.initialBalance.amount.toString(), currency: a.currency };
}

export function toAccount(row: StoredAccount): Account {
  return Account.create({
    id: row.id,
    name: row.name,
    type: row.type as AccountType,
    initialBalance: Money.of(BigInt(row.initialBalance), row.currency),
  });
}

export function toStoredTransaction(t: Transaction): StoredTransaction {
  const x = t as Transaction & { accountId?: string; fromAccountId?: string; toAccountId?: string };
  const date = t.date.toISOString();
  const involved = t.type === 'TRANSFER' ? [x.fromAccountId, x.toAccountId] : [x.accountId];
  return {
    id: t.id,
    type: t.type,
    amount: t.amount.amount.toString(),
    currency: t.amount.currency,
    date,
    description: t.description,
    category: t.category ?? null,
    accountId: x.accountId ?? null,
    fromAccountId: x.fromAccountId ?? null,
    toAccountId: x.toAccountId ?? null,
    accountDates: involved.filter((id): id is string => !!id).map((id) => accountDateKey(id, date)),
  };
}

export function toTransaction(row: StoredTransaction): Transaction {
  const common = {
    id: row.id,
    amount: Money.of(BigInt(row.amount), row.currency),
    date: new Date(row.date),
    description: row.description,
    category: row.category ?? undefined,
  };
  if (row.type === 'TRANSFER') {
    return TransactionFactory.create({ ...common, type: 'TRANSFER', fromAccountId: row.fromAccountId!, toAccountId: row.toAccountId! });
  }
  return TransactionFactory.create({ ...common, type: row.type, accountId: row.accountId! });
}

export function toStoredScheduled(s: ScheduledExpense): StoredScheduledExpense {
  return {
    id: s.id,
    description: s.description,
    amount: s.amount.amount.toString(),
    currency: s.amount.currency,
    accountId: s.accountId,
    frequency: s.frequency,
    startDate: s.startDate.toISOString(),
    endDate: s.endDate?.toISOString() ?? null,
    settledThrough: s.settledThrough?.toISOString() ?? null,
  };
}

export function toScheduled(row: StoredScheduledExpense): ScheduledExpense {
  return ScheduledExpense.create({
    id: row.id,
    description: row.description,
    amount: Money.of(BigInt(row.amount), row.currency),
    accountId: row.accountId,
    frequency: row.frequency as Frequency,
    startDate: new Date(row.startDate),
    endDate: row.endDate ? new Date(row.endDate) : undefined,
    settledThrough: row.settledThrough ? new Date(row.settledThrough) : undefined,
  });
}

export const isAccountType = (v: unknown): v is AccountType => ACCOUNT_TYPES.includes(v as AccountType);
export const isFrequency = (v: unknown): v is Frequency => FREQUENCIES.includes(v as Frequency);
