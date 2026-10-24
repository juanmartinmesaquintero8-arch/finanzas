import { notFound } from 'next/navigation';
import { EditAccountContainer } from '@/components/EditAccountContainer';
import { ErrorCard } from '@/components/ErrorCard';
import ui from '@/components/ui.module.css';
import { getApiClient } from '@/lib/api-client';
import { describeError } from '@/lib/server-context';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Editar cuenta · Mis Finanzas' };

export default async function EditAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let accounts;
  try {
    accounts = await getApiClient().listAccounts();
  } catch (e) {
    return <ErrorCard message={describeError(e)} />;
  }
  const account = accounts.find((a) => a.id === id);
  if (!account) notFound();
  return (
    <>
      <h1 className={ui.pageTitle}>Editar cuenta</h1>
      <EditAccountContainer account={account} />
    </>
  );
}
