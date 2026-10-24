'use client';

import { formatShortDate, todayISO, ui } from '@finanzas/ui';
import { useState, type ChangeEvent } from 'react';
import { parseBackup, type BackupSummary } from '@/application/backup';
import type { LedgerSnapshot } from '@/data/idb-ledger-store';
import { InstallPrompt } from '@/pwa/install';
import { useServices } from '@/state/services-provider';
import { useLive } from '@/state/use-live';
import { deliverBackup, type DeliveryResult } from './deliver-backup';

type Notice = { kind: 'ok' | 'error'; text: string } | null;
type Pending =
  | { step: 'restore'; snapshot: LedgerSnapshot; summary: BackupSummary }
  | { step: 'erase-1' }
  | { step: 'erase-2' }
  | null;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const readText = (file: File): Promise<string> =>
  typeof file.text === 'function'
    ? file.text()
    : new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
      });

const DELIVERY_TEXT: Record<DeliveryResult, { kind: 'ok' | 'error'; text: string }> = {
  shared: { kind: 'ok', text: 'Tu copia está lista. Guárdala en un lugar seguro, como tu correo o Google Drive.' },
  downloaded: {
    kind: 'ok',
    text: 'Tu copia está lista: quedó guardada en las descargas de tu celular. Envíala a tu correo o a Drive para tenerla a salvo.',
  },
  cancelled: { kind: 'ok', text: 'No se envió la copia. Cuando quieras, vuelve a intentarlo.' },
};

export function SettingsScreen({ deliver = deliverBackup }: { deliver?: typeof deliverBackup }) {
  const services = useServices();
  const { data } = useLive(async (s) => ({ last: await s.backup.lastBackupAt(), hasSample: await s.data.hasSample() }));
  const [notice, setNotice] = useState<Notice>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);

  async function makeBackup() {
    setBusy(true);
    setNotice(null);
    try {
      const backup = await services.backup.create();
      const result = await deliver(backup);
      if (result !== 'cancelled') await services.backup.markDone(backup.exportedAt);
      setNotice(DELIVERY_TEXT[result]);
    } catch {
      setNotice({ kind: 'error', text: 'No pudimos hacer la copia. Intenta de nuevo.' });
    } finally {
      setBusy(false);
    }
  }

  async function pickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setNotice(null);
    setPending(null);
    let text: string;
    try {
      text = await readText(file);
    } catch {
      setNotice({ kind: 'error', text: 'No pudimos leer ese archivo. Intenta con otro.' });
      return;
    }
    const parsed = parseBackup(text);
    if (!parsed.ok) setNotice({ kind: 'error', text: parsed.error });
    else setPending({ step: 'restore', snapshot: parsed.snapshot, summary: parsed.summary });
  }

  async function confirmRestore(snapshot: LedgerSnapshot) {
    setBusy(true);
    const res = await services.backup.restore(snapshot);
    setPending(null);
    setNotice(res.ok ? { kind: 'ok', text: 'Listo, recuperamos tu copia.' } : { kind: 'error', text: res.error });
    setBusy(false);
  }

  async function confirmErase() {
    setBusy(true);
    const res = await services.data.eraseAll();
    setPending(null);
    setNotice(res.ok ? { kind: 'ok', text: 'Borramos todos tus datos. La app quedó como nueva.' } : { kind: 'error', text: res.error });
    setBusy(false);
  }

  const lastText = data?.last
    ? `Última copia: ${formatShortDate(todayISO(new Date(data.last)))}`
    : 'Todavía no has hecho una copia.';

  return (
    <>
      <h1 className={ui.pageTitle}>Ajustes</h1>

      {notice && (
        <p role={notice.kind === 'ok' ? 'status' : 'alert'} className={notice.kind === 'ok' ? ui.card : ui.alert}>
          {notice.text}
        </p>
      )}

      <section className={`${ui.card} ${ui.stack}`} aria-labelledby="backup-title">
        <h2 id="backup-title">Copia de seguridad</h2>
        <p>Tus datos solo están guardados en este celular. Si lo pierdes o lo cambias, la copia te permite recuperarlos.</p>
        <p>{lastText}</p>
        <button type="button" className={ui.button} onClick={makeBackup} disabled={busy}>
          Hacer copia de seguridad
        </button>
      </section>

      <section className={`${ui.card} ${ui.stack}`} aria-labelledby="restore-title">
        <h2 id="restore-title">Recuperar mis datos</h2>
        <p>Elige el archivo de una copia que hiciste antes. Antes de cambiar nada, te mostramos qué trae.</p>
        <label htmlFor="restore-file" className={ui.buttonGhost}>
          Recuperar copia
        </label>
        <input id="restore-file" type="file" accept=".json,application/json" className="sr-only" onChange={pickFile} />
      </section>

      {pending?.step === 'restore' && (
        <section role="alertdialog" aria-labelledby="restore-q" aria-describedby="restore-d" className={`${ui.card} ${ui.stack}`}>
          <h2 id="restore-q">¿Recuperar esta copia?</h2>
          <p id="restore-d">
            Trae {plural(pending.summary.accounts, 'cuenta', 'cuentas')}, {plural(pending.summary.transactions, 'movimiento', 'movimientos')} y{' '}
            {plural(pending.summary.scheduledExpenses, 'gasto programado', 'gastos programados')}
            {pending.summary.exportedAt ? ` (hecha el ${formatShortDate(todayISO(new Date(pending.summary.exportedAt)))})` : ''}. Al recuperarla se
            reemplaza todo lo que tienes ahora en este celular.
          </p>
          <button type="button" className={ui.buttonDanger} disabled={busy} onClick={() => confirmRestore(pending.snapshot)}>
            Sí, recuperar
          </button>
          <button type="button" className={ui.buttonGhost} onClick={() => setPending(null)}>
            Cancelar
          </button>
        </section>
      )}

      {data?.hasSample && (
        <section className={`${ui.card} ${ui.stack}`} aria-labelledby="sample-title">
          <h2 id="sample-title">Datos de ejemplo</h2>
          <p>Estás viendo datos de ejemplo para conocer la app. Bórralos cuando quieras empezar con los tuyos.</p>
          <button type="button" className={ui.buttonGhost} onClick={() => void services.data.removeSample()}>
            Borrar datos de ejemplo
          </button>
        </section>
      )}

      <InstallPrompt />

      <section className={`${ui.card} ${ui.stack}`} aria-labelledby="erase-title">
        <h2 id="erase-title">Empezar de cero</h2>
        <p>Borra todas tus cuentas, movimientos y gastos programados de este celular.</p>
        <button type="button" className={ui.buttonDanger} onClick={() => setPending({ step: 'erase-1' })}>
          Borrar todos mis datos
        </button>
      </section>

      {pending?.step === 'erase-1' && (
        <section role="alertdialog" aria-labelledby="erase-q1" className={`${ui.card} ${ui.stack}`}>
          <h2 id="erase-q1">¿Seguro que quieres borrar todos tus datos?</h2>
          <p>Te recomendamos hacer una copia de seguridad antes.</p>
          <button type="button" className={ui.buttonDanger} onClick={() => setPending({ step: 'erase-2' })}>
            Sí, continuar
          </button>
          <button type="button" className={ui.buttonGhost} onClick={() => setPending(null)}>
            No, volver
          </button>
        </section>
      )}

      {pending?.step === 'erase-2' && (
        <section role="alertdialog" aria-labelledby="erase-q2" className={`${ui.card} ${ui.stack}`}>
          <h2 id="erase-q2">Última pregunta</h2>
          <p>Esto no se puede deshacer. Se borrarán todas tus cuentas, movimientos y gastos programados.</p>
          <button type="button" className={ui.buttonDanger} disabled={busy} onClick={confirmErase}>
            Sí, borrar todo
          </button>
          <button type="button" className={ui.buttonGhost} onClick={() => setPending(null)}>
            No, volver
          </button>
        </section>
      )}
    </>
  );
}
