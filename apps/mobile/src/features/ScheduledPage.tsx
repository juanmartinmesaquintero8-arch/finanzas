'use client';

import { ScheduledKindSwitch, ScheduledScreen, ui } from '@finanzas/ui';
import { useSearchParams } from 'next/navigation';
import { useServices } from '@/state/services-provider';
import { useLive } from '@/state/use-live';
import { routes } from './routes';

export function ScheduledPage() {
  const services = useServices();
  const incomes = useSearchParams().get('tipo') === 'ingresos';
  const { data } = useLive(
    async (s) => {
      const [items, accounts] = await Promise.all([incomes ? s.scheduledIncomes.list() : s.scheduled.list(), s.accounts.list()]);
      return { items, accounts, incomes };
    },
    [incomes],
  );
  if (!data) return <p className={ui.empty}>Cargando…</p>;
  return (
    <>
      <h1 className={ui.pageTitle}>Programados</h1>
      <ScheduledKindSwitch active={incomes ? 'incomes' : 'expenses'} expensesHref={routes.scheduled} incomesHref={routes.scheduledIncomes} />
      {/* Al cambiar de pestaña, la lista de la otra sigue en pantalla hasta que llegan los datos nuevos: no se muestra. */}
      {data.incomes !== incomes ? (
        <p className={ui.empty}>Cargando…</p>
      ) : incomes ? (
        <ScheduledScreen
          key="incomes"
          kind="income"
          withCategory
          items={data.items}
          accounts={data.accounts}
          today={services.today()}
          onCreate={(input) => services.scheduledIncomes.create(input)}
          onUpdate={(id, input) => services.scheduledIncomes.update(id, input)}
          onSettle={(id, through) => services.scheduledIncomes.receive(id, through)}
          onDelete={(id) => services.scheduledIncomes.remove(id)}
        />
      ) : (
        <ScheduledScreen
          key="expenses"
          withCategory
          items={data.items}
          accounts={data.accounts}
          today={services.today()}
          onCreate={(input) => services.scheduled.create(input)}
          onUpdate={(id, input) => services.scheduled.update(id, input)}
          onSettle={(id, through) => services.scheduled.settle(id, through)}
          onDelete={(id) => services.scheduled.remove(id)}
        />
      )}
    </>
  );
}
