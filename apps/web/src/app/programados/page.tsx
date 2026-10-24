import { ErrorCard, ui, todayISO } from '@finanzas/ui';
import { ScheduledContainer } from '@/components/ScheduledContainer';
import { getApiClient } from '@/lib/api-client';
import { describeError } from '@/lib/server-context';

export const dynamic = 'force-dynamic';

export default async function ScheduledPage() {
  const api = getApiClient();
  let items, accounts;
  try {
    [items, accounts] = await Promise.all([api.listScheduledExpenses(), api.listAccounts()]);
  } catch (e) {
    return <ErrorCard message={describeError(e)} />;
  }
  return (
    <>
      <h1 className={ui.pageTitle}>Gastos programados</h1>
      <ScheduledContainer items={items} accounts={accounts} today={todayISO()} />
    </>
  );
}
