'use client';

import { NewAccountForm, ui } from '@finanzas/ui';
import { useRouter } from 'next/navigation';
import { useServices } from '@/state/services-provider';
import { routes } from './routes';

export function NewAccountScreen() {
  const router = useRouter();
  const services = useServices();
  return (
    <>
      <h1 className={ui.pageTitle}>Nueva cuenta</h1>
      <NewAccountForm onSubmit={(input) => services.accounts.create(input)} onDone={() => router.push(routes.home)} />
    </>
  );
}
