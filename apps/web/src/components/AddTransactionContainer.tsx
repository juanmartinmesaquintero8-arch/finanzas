'use client';

import { useRouter } from 'next/navigation';
import { createTransactionAction } from '@/app/actions';
import type { Account } from '@/lib/types';
import { AddTransactionForm } from './AddTransactionForm';

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
