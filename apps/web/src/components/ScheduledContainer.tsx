'use client';

import {
  createScheduledExpenseAction,
  deleteScheduledExpenseAction,
  settleScheduledExpenseAction,
  updateScheduledExpenseAction,
} from '@/app/actions';
import { ScheduledScreen, type Account, type ScheduledExpense } from '@finanzas/ui';

interface Props {
  items: ScheduledExpense[];
  accounts: Account[];
  today: string;
}

/** Conecta la pantalla de gastos programados con las Server Actions. */
export function ScheduledContainer({ items, accounts, today }: Props) {
  return (
    <ScheduledScreen
      items={items}
      accounts={accounts}
      today={today}
      onCreate={createScheduledExpenseAction}
      onUpdate={updateScheduledExpenseAction}
      onSettle={settleScheduledExpenseAction}
      onDelete={deleteScheduledExpenseAction}
    />
  );
}
