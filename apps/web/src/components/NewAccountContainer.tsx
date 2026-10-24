'use client';

import { useRouter } from 'next/navigation';
import { createAccountAction } from '@/app/actions';
import { NewAccountForm } from '@finanzas/ui';

export function NewAccountContainer() {
  const router = useRouter();
  return <NewAccountForm onSubmit={createAccountAction} onDone={() => router.push('/')} />;
}
