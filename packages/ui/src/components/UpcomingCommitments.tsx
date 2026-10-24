import { formatMoneyView, formatShortDate } from '../lib/format';
import type { Projection } from '../lib/types';
import styles from './UpcomingCommitments.module.css';
import ui from './ui.module.css';

interface Props {
  commitments: Projection['commitments'];
  accountNames: ReadonlyMap<string, string>;
}

/** Próximos compromisos (los 5 primeros del periodo elegido). */
export function UpcomingCommitments({ commitments, accountNames }: Props) {
  const next = commitments.slice(0, 5);
  return (
    <section className={ui.stack} aria-labelledby="upcoming-title">
      <h2 id="upcoming-title" className={styles.title}>
        Próximos compromisos
      </h2>
      {next.length === 0 ? (
        <p className={`${ui.card} ${ui.empty}`}>No tienes pagos programados en este periodo.</p>
      ) : (
        <ul className={`${ui.card} ${styles.list}`}>
          {next.map((c) => (
            <li key={`${c.scheduledExpenseId}-${c.date}`} className={styles.row}>
              <div className={styles.info}>
                <span className={styles.desc}>{c.description}</span>
                <span className={styles.meta}>
                  {formatShortDate(c.date)} · {accountNames.get(c.accountId) ?? 'Cuenta'}
                </span>
              </div>
              <span className={styles.amount}>{formatMoneyView(c.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
