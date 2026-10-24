import { Account, Money, ScheduledExpense, Transaction, TransactionFactory } from '@finanzas/domain';
import { Account as AccountRow, ScheduledExpense as ScheduledRow, Transaction as TransactionRow } from '@prisma/client';

export function toAccount(row: AccountRow): Account {
  return Account.create({
    id: row.id,
    name: row.name,
    type: row.type,
    initialBalance: Money.of(row.initialBalance, row.currency),
  });
}

export function toTransaction(row: TransactionRow): Transaction {
  const common = {
    id: row.id,
    amount: Money.of(row.amount, row.currency),
    date: row.date,
    description: row.description,
    category: row.category ?? undefined,
  };
  if (row.type === 'TRANSFER') {
    return TransactionFactory.create({ ...common, type: 'TRANSFER', fromAccountId: row.fromAccountId!, toAccountId: row.toAccountId! });
  }
  return TransactionFactory.create({ ...common, type: row.type, accountId: row.accountId! });
}

export function toTransactionData(t: Transaction) {
  const base = {
    id: t.id,
    type: t.type,
    amount: t.amount.amount,
    currency: t.amount.currency,
    date: t.date,
    description: t.description,
    category: t.category ?? null,
  };
  if (t.type === 'TRANSFER') {
    const { fromAccountId, toAccountId } = t as Transaction & { fromAccountId: string; toAccountId: string };
    return { ...base, accountId: null, fromAccountId, toAccountId };
  }
  return { ...base, accountId: (t as Transaction & { accountId: string }).accountId, fromAccountId: null, toAccountId: null };
}

export function toScheduledExpense(row: ScheduledRow): ScheduledExpense {
  return ScheduledExpense.create({
    id: row.id,
    description: row.description,
    amount: Money.of(row.amount, row.currency),
    accountId: row.accountId,
    frequency: row.frequency,
    startDate: row.startDate,
    endDate: row.endDate ?? undefined,
    settledThrough: row.settledThrough ?? undefined,
  });
}

export function toScheduledData(s: ScheduledExpense) {
  return {
    id: s.id,
    description: s.description,
    amount: s.amount.amount,
    currency: s.amount.currency,
    accountId: s.accountId,
    frequency: s.frequency,
    startDate: s.startDate,
    endDate: s.endDate ?? null,
    settledThrough: s.settledThrough ?? null,
  };
}
