'use client';

import { useRouter } from 'next/navigation';
import { updateTransactionAction } from '@/app/actions';
import { AddTransactionForm, type Account, type Transaction } from '@finanzas/ui';

interface Props {
  transaction: Transaction;
  accounts: Account[];
  today: string;
}

/** Edita un movimiento reutilizando el formulario de "Agregar", precargado. */
export function EditTransactionContainer({ transaction, accounts, today }: Props) {
  const router = useRouter();
  const goBack = () => router.push('/historial');
  return (
    <AddTransactionForm
      accounts={accounts}
      today={today}
      transaction={transaction}
      onSubmit={(input) => updateTransactionAction(transaction.id, input)}
      onDone={goBack}
      onCancel={goBack}
    />
  );
}
