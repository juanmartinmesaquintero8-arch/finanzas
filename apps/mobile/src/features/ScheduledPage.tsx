'use client';

import { CardsScreen, ScheduledKindSwitch, ScheduledScreen, ui } from '@finanzas/ui';
import { useSearchParams } from 'next/navigation';
import { useServices } from '@/state/services-provider';
import { useLive } from '@/state/use-live';
import { routes } from './routes';

type Kind = 'expenses' | 'incomes' | 'cards';

function kindOf(tipo: string | null): Kind {
  if (tipo === 'ingresos') return 'incomes';
  return tipo === 'tarjetas' ? 'cards' : 'expenses';
}

export function ScheduledPage() {
  const services = useServices();
  const kind = kindOf(useSearchParams().get('tipo'));
  const { data } = useLive(
    async (s) => {
      const [items, cards, accounts] = await Promise.all([
        kind === 'cards' ? [] : kind === 'incomes' ? s.scheduledIncomes.list() : s.scheduled.list(),
        kind === 'cards' ? s.cards.list() : [],
        s.accounts.list(),
      ]);
      return { items, cards, accounts, kind };
    },
    [kind],
  );
  if (!data) return <p className={ui.empty}>Cargando…</p>;
  return (
    <>
      <h1 className={ui.pageTitle}>Programados</h1>
      <ScheduledKindSwitch active={kind} expensesHref={routes.scheduled} incomesHref={routes.scheduledIncomes} cardsHref={routes.scheduledCards} />
      {/* Al cambiar de pestaña, la lista de la otra sigue en pantalla hasta que llegan los datos nuevos: no se muestra. */}
      {data.kind !== kind ? (
        <p className={ui.empty}>Cargando…</p>
      ) : kind === 'cards' ? (
        <CardsScreen key="cards" cards={data.cards} accounts={data.accounts} today={services.today()} api={services.cards} />
      ) : kind === 'incomes' ? (
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
