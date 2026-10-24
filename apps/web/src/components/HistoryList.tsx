'use client';

import Link from 'next/link';
import { useState } from 'react';
import { groupTransactionsByDay, transactionTitle } from '@/lib/domain-helpers';
import { formatDayHeading, formatMoneyView } from '@/lib/format';
import type { Account, Transaction } from '@/lib/types';
import styles from './HistoryList.module.css';
import ui from './ui.module.css';

interface Props {
  items: Transaction[];
  accounts: Account[];
  onDelete: (id: string) => Promise<void>;
  /** Sólo para pruebas: fija "hoy". */
  now?: Date;
}

const SIGN = { INCOME: '+', EXPENSE: '-', TRANSFER: '' } as const;
const ICON = { INCOME: '+', EXPENSE: '−', TRANSFER: '⇄' } as const;
const TYPE_LABEL = { INCOME: 'Ingreso', EXPENSE: 'Gasto', TRANSFER: 'Transferencia' } as const;

export function HistoryList({ items, accounts, onDelete, now }: Props) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const names = new Map(accounts.map((a) => [a.id, a.name]));

  if (items.length === 0) {
    return <p className={ui.empty}>Todavía no hay movimientos. Usa “Agregar” para registrar el primero.</p>;
  }

  async function confirmDelete(id: string) {
    setBusy(id);
    setError(null);
    try {
      await onDelete(id);
      setConfirming(null);
    } catch {
      setError('No pudimos eliminar el movimiento. Intenta de nuevo.');
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
      {groupTransactionsByDay(items).map((group) => (
        <section key={group.day} className={styles.group} aria-label={formatDayHeading(group.day, now)}>
          <h3 className={styles.heading}>{formatDayHeading(group.day, now)}</h3>
          <ul className={`${ui.card} ${styles.list}`}>
            {group.items.map((t) => (
              <li key={t.id} className={styles.row}>
                <Link href={`/movimientos/${t.id}/editar`} className={styles.link} aria-label={`Editar ${t.description}`}>
                <span className={`${styles.icon} ${styles[t.type]}`} role="img" aria-label={TYPE_LABEL[t.type]}>
                  {ICON[t.type]}
                </span>
                <div className={styles.main}>
                  <span className={styles.desc}>{t.description}</span>
                  <span className={styles.meta}>
                    <span>{transactionTitle(t, names)}</span>
                    {t.category && <span className={styles.tag}>{t.category}</span>}
                  </span>
                </div>
                <span className={`${styles.amount} ${styles[`amount${t.type}`]}`}>
                  {SIGN[t.type]}
                  {formatMoneyView(t.amount)}
                </span>
                </Link>
                {confirming === t.id ? (
                  <div className={styles.confirm}>
                    <p>¿Eliminar este movimiento?</p>
                    <button
                      type="button"
                      className={ui.buttonDanger}
                      disabled={busy === t.id}
                      onClick={() => confirmDelete(t.id)}
                    >
                      Sí, eliminar
                    </button>
                    <button type="button" className={ui.buttonGhost} onClick={() => setConfirming(null)}>
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className={styles.delete}
                    aria-label={`Eliminar ${t.description}`}
                    onClick={() => setConfirming(t.id)}
                  >
                    <span aria-hidden="true">🗑</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
