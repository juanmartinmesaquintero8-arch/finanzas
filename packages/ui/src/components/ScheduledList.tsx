'use client';

import { useState } from 'react';
import { hasDueOccurrence, nextOccurrence } from '../lib/domain-helpers';
import { formatMoneyView, formatShortDate, frequencyLabel } from '../lib/format';
import { SCHEDULED_COPY, type ScheduledKind } from '../lib/scheduled-copy';
import type { Account, ScheduledExpense } from '../lib/types';
import styles from './ScheduledList.module.css';
import ui from './ui.module.css';

interface Props {
  items: ScheduledExpense[];
  accounts: Account[];
  today: string;
  onSettle: (id: string, through: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onEdit?: (item: ScheduledExpense) => void;
  /** Gasto (por defecto) o ingreso programado. */
  kind?: ScheduledKind;
}

export function ScheduledList({ items, accounts, today, onSettle, onDelete, onEdit, kind = 'expense' }: Props) {
  const copy = SCHEDULED_COPY[kind];
  const income = kind === 'income';
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const names = new Map(accounts.map((a) => [a.id, a.name]));

  if (items.length === 0) {
    return <p className={ui.empty}>{copy.empty}</p>;
  }

  async function run(id: string, action: () => Promise<void>, failure: string) {
    setBusy(id);
    setError(null);
    try {
      await action();
      setConfirming(null);
    } catch {
      setError(failure);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={ui.stack}>
      {error && (
        <p role="alert" className={ui.alert}>
          {error}
        </p>
      )}
      <ul className={styles.list}>
        {items.map((s) => {
          const next = nextOccurrence(s, today);
          // Un ingreso solo se puede registrar cuando su fecha ya llegó; un gasto, mientras tenga un próximo pago.
          const canSettle = income ? hasDueOccurrence(s, today) : !!next;
          return (
            <li key={s.id} className={`${ui.card} ${styles.item}`}>
              <div className={styles.top}>
                <div className={styles.info}>
                  <span className={styles.desc}>{s.description}</span>
                  <span className={styles.freq}>{frequencyLabel(s.frequency, s.startDate)}</span>
                </div>
                <span className={income ? styles.amountIncome : styles.amount}>
                  {income ? `+ ${formatMoneyView(s.amount)}` : formatMoneyView(s.amount)}
                </span>
              </div>
              <p className={styles.meta}>
                <span>{names.get(s.accountId) ?? 'Cuenta'}</span>
                <span>{next ? `${copy.nextLabel}: ${formatShortDate(next)}` : copy.noneLeft}</span>
              </p>
              {confirming === s.id ? (
                <div className={styles.actions}>
                  <p className={styles.ask}>{copy.deleteQuestion}</p>
                  <button
                    type="button"
                    className={ui.buttonDanger}
                    disabled={busy === s.id}
                    onClick={() => run(s.id, () => onDelete(s.id), 'No pudimos eliminarlo. Intenta de nuevo.')}
                  >
                    Sí, eliminar
                  </button>
                  <button type="button" className={ui.buttonGhost} onClick={() => setConfirming(null)}>
                    Cancelar
                  </button>
                </div>
              ) : (
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={ui.button}
                    disabled={busy === s.id || !canSettle}
                    aria-label={`${copy.settleLabel}: ${s.description}`}
                    onClick={() => run(s.id, () => onSettle(s.id, today), copy.settleError)}
                  >
                    {copy.settleLabel}
                  </button>
                  {onEdit && (
                    <button
                      type="button"
                      className={ui.buttonGhost}
                      aria-label={`Editar ${s.description}`}
                      onClick={() => onEdit(s)}
                    >
                      Editar
                    </button>
                  )}
                  <button
                    type="button"
                    className={ui.buttonGhost}
                    aria-label={`Eliminar ${s.description}`}
                    onClick={() => setConfirming(s.id)}
                  >
                    Eliminar
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
