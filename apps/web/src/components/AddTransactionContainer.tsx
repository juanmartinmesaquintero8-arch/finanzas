'use client';

import { useRouter } from 'next/navigation';
import { createTransactionAction } from '@/app/actions';
import { AddTransactionForm, type Account } from '@finanzas/ui';

export function AddTransactionContainer({ accounts, today }: { accounts: Account[]; today: string }) {
  const router = useRouter();
  return (
    <AddTransactionForm
      accounts={accounts}
      today={today}
      onSubmit={createTransactionAction}
      onDone={() => router.push('/historial')}
    />
  );
}
