'use client';

import { AccountFilterChips, HistoryView, ui } from '@finanzas/ui';
import { useSearchParams } from 'next/navigation';
import { useServices } from '@/state/services-provider';
import { useLive } from '@/state/use-live';
import { routes } from './routes';

export function HistoryScreen() {
  const cuenta = useSearchParams().get('cuenta') ?? undefined;
  const services = useServices();
  // Se lee al abrir o al cambiar de cuenta; "Cargar más" y borrar los maneja la propia lista.
  const { data, error } = useLive(
    async (s) => {
      const [accounts, page] = await Promise.all([s.accounts.list(), s.transactions.page({ accountId: cuenta, limit: 20 })]);
      return { accounts, page };
    },
    [cuenta],
    { live: false },
  );

  if (error && !data) return <p role="alert" className={ui.alert}>{error}</p>;
  if (!data) return <p className={ui.empty}>Cargando…</p>;

  return (
    <>
      <h1 className={ui.pageTitle}>Historial</h1>
      <AccountFilterChips accounts={data.accounts} selectedId={cuenta} hrefFor={routes.historyByAccount} />
      <HistoryView
        key={cuenta ?? 'todas'}
        initialPage={data.page}
        accounts={data.accounts}
        accountId={cuenta}
        editHref={routes.editTransaction}
        loadPage={({ accountId, cursor }) => services.transactions.page({ accountId, cursor, limit: 20 })}
        onDelete={async (id) => {
          const res = await services.transactions.remove(id);
          if (!res.ok) throw new Error(res.error);
        }}
      />
    </>
  );
}
