import { Account, ScheduledExpense, Transaction } from '@finanzas/domain';

export interface MoneyView {
  amount: string;
  currency: string;
}

export interface AccountView {
  id: string;
  name: string;
  type: string;
  initialBalance: MoneyView;
}

export interface TransactionView {
  id: string;
  type: string;
  amount: MoneyView;
  date: string;
  description: string;
  category: string | null;
  accountId: string | null;
  fromAccountId: string | null;
  toAccountId: string | null;
}

export interface ScheduledExpenseView {
  id: string;
  description: string;
  amount: MoneyView;
  accountId: string;
  frequency: string;
  startDate: string;
  endDate: string | null;
  settledThrough: string | null;
}

export const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

export function toAccountView(a: Account): AccountView {
  return { id: a.id, name: a.name, type: a.type, initialBalance: a.initialBalance.toJSON() };
}

export function toTransactionView(t: Transaction): TransactionView {
  const anyT = t as Transaction & { accountId?: string; fromAccountId?: string; toAccountId?: string };
  return {
    id: t.id,
    type: t.type,
    amount: t.amount.toJSON(),
    date: t.date.toISOString(),
    description: t.description,
    category: t.category ?? null,
    accountId: anyT.accountId ?? null,
    fromAccountId: anyT.fromAccountId ?? null,
    toAccountId: anyT.toAccountId ?? null,
  };
}

export function toScheduledExpenseView(s: ScheduledExpense): ScheduledExpenseView {
  return {
    id: s.id,
    description: s.description,
    amount: s.amount.toJSON(),
    accountId: s.accountId,
    frequency: s.frequency,
    startDate: isoDay(s.startDate),
    endDate: s.endDate ? isoDay(s.endDate) : null,
    settledThrough: s.settledThrough ? isoDay(s.settledThrough) : null,
  };
}
