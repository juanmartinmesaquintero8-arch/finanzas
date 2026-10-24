import { ui } from '@finanzas/ui';
import Link from 'next/link';

/** Recordatorio suave para hacer la copia de seguridad. */
export function BackupReminder({ lastBackupAt }: { lastBackupAt: string | null }) {
  return (
    <aside className={`${ui.card} ${ui.stack}`} aria-label="Recordatorio de copia de seguridad">
      <p>
        {lastBackupAt
          ? 'Hace más de una semana que no haces una copia de seguridad.'
          : 'Todavía nunca has hecho una copia de seguridad.'}{' '}
        Hazla para no perder tu información si pierdes o cambias de celular.
      </p>
      <Link href="/ajustes" className={ui.buttonGhost}>
        Hacer mi copia ahora
      </Link>
    </aside>
  );
}
