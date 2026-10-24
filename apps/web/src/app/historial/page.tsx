import { AccountFilterChips, ErrorCard, ui } from '@finanzas/ui';
import { HistoryContainer } from '@/components/HistoryContainer';
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
      <AccountFilterChips accounts={accounts} selectedId={cuenta} />
      <HistoryContainer key={cuenta ?? 'todas'} initialPage={page} accounts={accounts} accountId={cuenta} />
    </>
  );
}
