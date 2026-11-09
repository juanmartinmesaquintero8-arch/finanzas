'use client';

import { SpendingBreakdown, ui } from '@finanzas/ui';
import { useLive } from '@/state/use-live';
import { routes } from './routes';

/** "En qué gasto": el mes viene de la dirección (?mes=2026-10); el servicio lo acota a los últimos 24 meses. */
export function SpendingScreen({ month }: { month?: string }) {
  const { data, error } = useLive((s) => s.spending.month(month), [month]);

  if (error && !data) return <p role="alert" className={ui.alert}>{error}</p>;
  if (!data) return <p className={ui.empty}>Cargando…</p>;

  return (
    <SpendingBreakdown
      view={data}
      monthHref={routes.spending}
      rowHref={(categoria) => routes.historyFiltered({ mes: data.month, categoria })}
    />
  );
}
