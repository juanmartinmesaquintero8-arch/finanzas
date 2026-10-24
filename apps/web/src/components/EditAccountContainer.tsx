'use client';

import { useRouter } from 'next/navigation';
import { updateAccountAction } from '@/app/actions';
import { NewAccountForm, type Account } from '@finanzas/ui';

/** Edita una cuenta reutilizando el formulario de cuenta nueva, precargado. */
export function EditAccountContainer({ account }: { account: Account }) {
  const router = useRouter();
  const goHome = () => router.push('/');
  return (
    <NewAccountForm
      account={account}
      onSubmit={(input) => updateAccountAction(account.id, input)}
      onDone={goHome}
      onCancel={goHome}
    />
  );
}
