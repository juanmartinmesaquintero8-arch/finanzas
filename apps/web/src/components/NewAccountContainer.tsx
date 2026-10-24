'use client';

import { useRouter } from 'next/navigation';
import { createAccountAction } from '@/app/actions';
import { NewAccountForm } from './NewAccountForm';

export function NewAccountContainer() {
  const router = useRouter();
  return <NewAccountForm onSubmit={createAccountAction} onDone={() => router.push('/')} />;
}
