import Link from 'next/link';
import { AddTransactionContainer } from '@/components/AddTransactionContainer';
import { ErrorCard } from '@/components/ErrorCard';
import ui from '@/components/ui.module.css';
import { getApiClient } from '@/lib/api-client';
import { todayISO } from '@/lib/format';
import { describeError } from '@/lib/server-context';

export const dynamic = 'force-dynamic';

export default async function AddPage() {
  let accounts;
  try {
    accounts = await getApiClient().listAccounts();
  } catch (e) {
    return <ErrorCard message={describeError(e)} />;
  }

  return (
    <>
      <h1 className={ui.pageTitle}>Agregar movimiento</h1>
      {accounts.length === 0 ? (
        <div className={`${ui.card} ${ui.stack}`}>
          <p>Primero necesitas una cuenta para registrar movimientos.</p>
          <Link href="/cuentas/nueva" className={ui.button}>
            Crear mi primera cuenta
          </Link>
        </div>
      ) : (
        <>
          <AddTransactionContainer accounts={accounts} today={todayISO()} />
          <Link href="/cuentas/nueva" className={ui.buttonGhost}>
            + Crear cuenta nueva
          </Link>
        </>
      )}
    </>
  );
}
