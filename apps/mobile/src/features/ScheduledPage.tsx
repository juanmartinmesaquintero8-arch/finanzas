'use client';

import { ScheduledScreen, ui } from '@finanzas/ui';
import { useServices } from '@/state/services-provider';
import { useLive } from '@/state/use-live';

export function ScheduledPage() {
  const services = useServices();
  const { data } = useLive(async (s) => {
    const [items, accounts] = await Promise.all([s.scheduled.list(), s.accounts.list()]);
    return { items, accounts };
  });
  if (!data) return <p className={ui.empty}>Cargando…</p>;
  return (
    <>
      <h1 className={ui.pageTitle}>Gastos programados</h1>
      <ScheduledScreen
        items={data.items}
        accounts={data.accounts}
        today={services.today()}
        onCreate={(input) => services.scheduled.create(input)}
        onUpdate={(id, input) => services.scheduled.update(id, input)}
        onSettle={(id, through) => services.scheduled.settle(id, through)}
        onDelete={(id) => services.scheduled.remove(id)}
      />
    </>
  );
}
