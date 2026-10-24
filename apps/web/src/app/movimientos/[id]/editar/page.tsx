import { notFound } from 'next/navigation';
import { EditTransactionContainer } from '@/components/EditTransactionContainer';
import { ErrorCard } from '@/components/ErrorCard';
import ui from '@/components/ui.module.css';
import { ApiError, getApiClient } from '@/lib/api-client';
import { todayISO } from '@/lib/format';
import { describeError } from '@/lib/server-context';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Editar movimiento · Mis Finanzas' };

export default async function EditTransactionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const api = getApiClient();
  let transaction, accounts;
  try {
    [transaction, accounts] = await Promise.all([api.getTransaction(id), api.listAccounts()]);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    return <ErrorCard message={describeError(e)} />;
  }
  return (
    <>
      <h1 className={ui.pageTitle}>Editar movimiento</h1>
      <EditTransactionContainer transaction={transaction} accounts={accounts} today={todayISO()} />
    </>
  );
}
