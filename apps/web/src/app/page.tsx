import Link from 'next/link';
import { AccountCards, AvailableBalanceCard, ErrorCard, UpcomingCommitments, ui, horizonEnd, isHorizon } from '@finanzas/ui';
import { getApiClient } from '@/lib/api-client';
import { describeError, todayForApi } from '@/lib/server-context';

export const dynamic = 'force-dynamic';

export default async function HomePage({ searchParams }: { searchParams: Promise<{ h?: string }> }) {
  const { h } = await searchParams;
  const horizon = isHorizon(h) ? h : 'month';

  let projection;
  try {
    projection = await getApiClient().getProjection(horizonEnd(horizon, todayForApi()));
  } catch (e) {
    return <ErrorCard message={describeError(e)} />;
  }

  if (projection.accounts.length === 0) {
    return (
      <section className={`${ui.card} ${ui.stack}`}>
        <h1 className={ui.pageTitle}>¡Bienvenido!</h1>
        <p>Para empezar, crea tu primera cuenta: por ejemplo tu efectivo, tu banco o tu billetera digital.</p>
        <Link href="/cuentas/nueva" className={ui.button}>
          Crear mi primera cuenta
        </Link>
      </section>
    );
  }

  const names = new Map(projection.accounts.map((a) => [a.accountId, a.name]));
  return (
    <>
      <h1 className="sr-only">Inicio</h1>
      <AvailableBalanceCard projection={projection} horizon={horizon} />
      <AccountCards accounts={projection.accounts} />
      <UpcomingCommitments commitments={projection.commitments} accountNames={names} />
    </>
  );
}
