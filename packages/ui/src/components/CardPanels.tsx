'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { ActionResult } from '../lib/action-result';
import { feeImpactText } from '../lib/cards';
import type { FeeImpact } from '../lib/types';
import { useSubmit } from '../lib/use-submit';
import styles from './CreditCards.module.css';
import ui from './ui.module.css';

/** Espacio bajo la fila donde se confirma una acción, sin salir de la lista. */
function Panel({ label, error, children }: { label: string; error: string | null; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className={`${styles.panel} ${styles.tall}`}>
      {children}
      {error && (
        <p role="alert" className={ui.alert}>
          {error}
        </p>
      )}
    </div>
  );
}

/** Confirmación que primero averigua qué cuotas de manejo se perderían; no deja confirmar hasta saberlo. */
export function FeeAwareConfirmPanel({ loadImpact, ...panel }: Omit<Parameters<typeof ConfirmPanel>[0], 'warning' | 'waiting'> & { loadImpact: () => Promise<FeeImpact> }) {
  const [state, setState] = useState<{ ready: boolean; warning: string | null }>({ ready: false, warning: null });
  useEffect(() => {
    let active = true;
    loadImpact().then(
      (impact) => active && setState({ ready: true, warning: feeImpactText(impact) }),
      () => active && setState({ ready: true, warning: null }),
    );
    return () => {
      active = false;
    };
    // Se calcula una sola vez, al abrir la confirmación.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <ConfirmPanel {...panel} warning={state.warning} waiting={!state.ready} />;
}

export function ConfirmPanel({ label, text, confirmLabel, cancelLabel = 'Cancelar', onConfirm, onDone, onCancel, warning, waiting }: {
  label: string;
  text: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => Promise<ActionResult>;
  onDone: () => void;
  onCancel: () => void;
  warning?: string | null;
  waiting?: boolean;
}) {
  const { pending, error, submit } = useSubmit(onDone);
  return (
    <Panel label={label} error={error}>
      <p className={styles.summary}>{text}</p>
      {warning && <p className={styles.warning}>{warning}</p>}
      <div className={styles.actions}>
        <button type="button" className={ui.buttonDanger} disabled={pending || waiting} onClick={() => void submit(onConfirm)}>
          {pending ? 'Guardando…' : confirmLabel}
        </button>
        <button type="button" className={ui.buttonGhost} disabled={pending} onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>
    </Panel>
  );
}
