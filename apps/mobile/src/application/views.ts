import type { Account, ScheduledExpense, Transaction } from '@finanzas/domain';
import type { Account as AccountView, ScheduledExpense as ScheduledExpenseView, Transaction as TransactionView } from '@finanzas/ui';
import { isoDay } from './support';

/** Del dominio a los tipos de vista que usan los componentes (montos como string). */
export function toAccountView(a: Account): AccountView {
  return { id: a.id, name: a.name, type: a.type, initialBalance: a.initialBalance.toJSON() };
}

export function toTransactionView(t: Transaction): TransactionView {
  const x = t as Transaction & { accountId?: string; fromAccountId?: string; toAccountId?: string };
  return {
    id: t.id,
    type: t.type,
    amount: t.amount.toJSON(),
    date: t.date.toISOString(),
    description: t.description,
    category: t.category ?? null,
    accountId: x.accountId ?? null,
    fromAccountId: x.fromAccountId ?? null,
    toAccountId: x.toAccountId ?? null,
  };
}

export function toScheduledView(s: ScheduledExpense): ScheduledExpenseView {
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
