import Link from 'next/link';
import { ErrorCard } from '@/components/ErrorCard';
import { HistoryContainer } from '@/components/HistoryContainer';
import ui from '@/components/ui.module.css';
import { getApiClient } from '@/lib/api-client';
import { describeError } from '@/lib/server-context';

export const dynamic = 'force-dynamic';

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ cuenta?: string }> }) {
  const { cuenta } = await searchParams;
  const api = getApiClient();

  let accounts, page;
  try {
    [accounts, page] = await Promise.all([api.listAccounts(), api.listTransactions({ accountId: cuenta, limit: 20 })]);
  } catch (e) {
    return <ErrorCard message={describeError(e)} />;
  }

  return (
    <>
      <h1 className={ui.pageTitle}>Historial</h1>
      <div className={ui.chips} role="group" aria-label="Filtrar por cuenta">
        <Link href="/historial" className={ui.chip} aria-current={cuenta ? undefined : 'true'} replace>
          Todas
        </Link>
        {accounts.map((a) => (
          <Link
            key={a.id}
            href={`/historial?cuenta=${a.id}`}
            className={ui.chip}
            aria-current={cuenta === a.id ? 'true' : undefined}
            replace
          >
            {a.name}
          </Link>
        ))}
      </div>
      <HistoryContainer key={cuenta ?? 'todas'} initialPage={page} accounts={accounts} accountId={cuenta} />
    </>
  );
}
