'use client';

import { AddTransactionForm, ui } from '@finanzas/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useServices } from '@/state/services-provider';
import { useLive } from '@/state/use-live';
import { routes } from './routes';

export function AddScreen() {
  const router = useRouter();
  const services = useServices();
  const { data: accounts } = useLive((s) => s.accounts.list());

  if (!accounts) return <p className={ui.empty}>Cargando…</p>;

  return (
    <>
      <h1 className={ui.pageTitle}>Agregar movimiento</h1>
      {accounts.length === 0 ? (
        <div className={`${ui.card} ${ui.stack}`}>
          <p>Primero necesitas una cuenta para registrar movimientos.</p>
          <Link href={routes.newAccount} className={ui.button}>
            Crear mi primera cuenta
          </Link>
        </div>
      ) : (
        <>
          <AddTransactionForm
            accounts={accounts}
            today={services.today()}
            onSubmit={(input) => services.transactions.create(input)}
            onDone={() => router.push(routes.history)}
          />
          <Link href={routes.newAccount} className={ui.buttonGhost}>
            + Crear cuenta nueva
          </Link>
        </>
      )}
    </>
  );
}
