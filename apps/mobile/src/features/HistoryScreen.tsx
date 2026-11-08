'use client';

import { UNCATEGORIZED_KEY, isMonthKey } from '@finanzas/domain';
import {
  AccountFilterChips,
  ActiveFilters,
  HistoryView,
  HistoryViewSwitch,
  formatMonthTitle,
  ui,
  type ActiveFilter,
} from '@finanzas/ui';
import { useSearchParams } from 'next/navigation';
import { useServices } from '@/state/services-provider';
import { useLive } from '@/state/use-live';
import { routes } from './routes';
import { SpendingScreen } from './SpendingScreen';

export function HistoryScreen() {
  const params = useSearchParams();
  const rawMonth = params.get('mes');
  const mes = isMonthKey(rawMonth) ? rawMonth : undefined;
  const spending = params.get('vista') === 'gasto';

  return (
    <>
      <h1 className={ui.pageTitle}>Historial</h1>
      {/* El mes se comparte entre las dos vistas solo si ya venía en la dirección. */}
      <HistoryViewSwitch
        active={spending ? 'spending' : 'movements'}
        movementsHref={routes.historyFiltered({ mes })}
        spendingHref={routes.spending(mes)}
      />
      {spending ? (
        <SpendingScreen month={mes} />
      ) : (
        <MovementsView mes={mes} categoria={params.get('categoria') || undefined} cuenta={params.get('cuenta') ?? undefined} />
      )}
    </>
  );
}

function MovementsView({ mes, categoria, cuenta }: { mes?: string; categoria?: string; cuenta?: string }) {
  const services = useServices();
  const filtered = mes !== undefined || categoria !== undefined;
  // Con un filtro de mes o categoría el filtro por cuenta se deja de lado, para no mezclar tres criterios.
  const accountId = filtered ? undefined : cuenta;
  // Se lee al abrir o al cambiar de filtro; "Cargar más" y borrar los maneja la propia lista.
  const { data, error } = useLive(
    async (s) => {
      const [accounts, page] = await Promise.all([
        s.accounts.list(),
        s.transactions.page({ accountId, month: mes, category: categoria, limit: 20 }),
      ]);
      return { accounts, page };
    },
    [accountId, mes, categoria],
    { live: false },
  );

  if (error && !data) return <p role="alert" className={ui.alert}>{error}</p>;
  if (!data) return <p className={ui.empty}>Cargando…</p>;

  const filters: ActiveFilter[] = [];
  if (categoria) {
    const label =
      categoria === UNCATEGORIZED_KEY ? 'Sin categoría' : (data.page.items[0]?.category?.replace(/\s+/g, ' ').trim() ?? categoria);
    filters.push({ label, removeLabel: `Quitar filtro de categoría: ${label}`, href: routes.historyFiltered({ mes }) });
  }
  if (mes) {
    const label = formatMonthTitle(mes);
    filters.push({ label, removeLabel: `Quitar filtro de mes: ${label}`, href: routes.historyFiltered({ categoria }) });
  }

  return (
    <>
      {filtered ? (
        <ActiveFilters filters={filters} />
      ) : (
        <AccountFilterChips accounts={data.accounts} selectedId={cuenta} hrefFor={routes.historyByAccount} />
      )}
      <HistoryView
        key={`${accountId ?? 'todas'}|${mes ?? ''}|${categoria ?? ''}`}
        initialPage={data.page}
        accounts={data.accounts}
        accountId={accountId}
        editHref={routes.editTransaction}
        loadPage={({ accountId: id, cursor }) =>
          services.transactions.page({ accountId: id, month: mes, category: categoria, cursor, limit: 20 })
        }
        onDelete={async (id) => {
          const res = await services.transactions.remove(id);
          if (!res.ok) throw new Error(res.error);
        }}
      />
    </>
  );
}
