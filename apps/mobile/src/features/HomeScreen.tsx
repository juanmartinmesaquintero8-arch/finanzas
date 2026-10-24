'use client';

import { AccountCards, AvailableBalanceCard, UpcomingCommitments, horizonEnd, isHorizon, ui } from '@finanzas/ui';
import { useSearchParams } from 'next/navigation';
import { InstallPrompt } from '@/pwa/install';
import { useServices } from '@/state/services-provider';
import { useLive } from '@/state/use-live';
import { BackupReminder } from './BackupReminder';
import { routes } from './routes';
import { WelcomeCard } from './WelcomeCard';

export function HomeScreen() {
  const h = useSearchParams().get('h');
  const horizon = isHorizon(h) ? h : 'month';
  const { data, error } = useLive(
    async (s) => {
      const [projection, hasSample, reminderDue, lastBackupAt] = await Promise.all([
        s.summary.projection(horizonEnd(horizon, s.today())),
        s.data.hasSample(),
        s.backup.reminderDue(),
        s.backup.lastBackupAt(),
      ]);
      return { projection, hasSample, reminderDue, lastBackupAt };
    },
    [horizon],
  );
  const services = useServices();

  if (error && !data) return <p role="alert" className={ui.alert}>{error}</p>;
  if (!data) return <p className={ui.empty}>Cargando…</p>;

  const { projection, hasSample, reminderDue, lastBackupAt } = data;
  if (projection.accounts.length === 0) {
    return <WelcomeCard onLoadSample={() => services.data.loadSample()} />;
  }

  const names = new Map(projection.accounts.map((a) => [a.accountId, a.name]));
  return (
    <>
      <h1 className="sr-only">Inicio</h1>
      {hasSample && (
        <section className={`${ui.card} ${ui.stack}`} aria-label="Datos de ejemplo">
          <p>Estás viendo datos de ejemplo. Cuando quieras empezar con los tuyos, bórralos.</p>
          <button type="button" className={ui.buttonGhost} onClick={() => void services.data.removeSample()}>
            Borrar datos de ejemplo
          </button>
        </section>
      )}
      <AvailableBalanceCard projection={projection} horizon={horizon} horizonHref={routes.homeHorizon} />
      <AccountCards accounts={projection.accounts} editHref={routes.editAccount} />
      <UpcomingCommitments commitments={projection.commitments} accountNames={names} />
      {reminderDue && <BackupReminder lastBackupAt={lastBackupAt} />}
      <InstallPrompt />
    </>
  );
}

