'use client';

import { AddTransactionForm, NewAccountForm, ui } from '@finanzas/ui';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useServices } from '@/state/services-provider';
import { useLive } from '@/state/use-live';
import { routes } from './routes';

function NotFound({ what, back }: { what: string; back: string }) {
  return (
    <div className={`${ui.card} ${ui.stack}`} role="alert">
      <p>No encontramos {what}. Puede que ya se haya eliminado.</p>
      <Link href={back} className={ui.button}>
        Volver
      </Link>
    </div>
  );
}

export function EditAccountScreen() {
  const id = useSearchParams().get('id') ?? '';
  const router = useRouter();
  const services = useServices();
  const { data: accounts } = useLive((s) => s.accounts.list(), [], { live: false });
  if (!accounts) return <p className={ui.empty}>Cargando…</p>;
  const account = accounts.find((a) => a.id === id);
  const goHome = () => router.push(routes.home);
  return (
    <>
      <h1 className={ui.pageTitle}>Editar cuenta</h1>
      {account ? (
        <NewAccountForm account={account} onSubmit={(input) => services.accounts.update(account.id, input)} onDone={goHome} onCancel={goHome} />
      ) : (
        <NotFound what="esa cuenta" back={routes.home} />
      )}
    </>
  );
}

export function EditTransactionScreen() {
  const id = useSearchParams().get('id') ?? '';
  const router = useRouter();
  const services = useServices();
  const { data } = useLive(
    async (s) => {
      const [transaction, accounts] = await Promise.all([s.transactions.get(id), s.accounts.list()]);
      return { transaction, accounts };
    },
    [id],
    { live: false },
  );
  if (!data) return <p className={ui.empty}>Cargando…</p>;
  const goBack = () => router.push(routes.history);
  return (
    <>
      <h1 className={ui.pageTitle}>Editar movimiento</h1>
      {data.transaction ? (
        <AddTransactionForm
          accounts={data.accounts}
          today={services.today()}
          transaction={data.transaction}
          onSubmit={(input) => services.transactions.update(id, input)}
          onDone={goBack}
          onCancel={goBack}
        />
      ) : (
        <NotFound what="ese movimiento" back={routes.history} />
      )}
    </>
  );
}
