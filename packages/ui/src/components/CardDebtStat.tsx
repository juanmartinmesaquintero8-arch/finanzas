import { formatMoneyCompact } from '../lib/format';
import styles from './CreditCards.module.css';
import ui from './ui.module.css';

/** Inicio: lo que se debe en tarjetas. Es informativo: el Saldo Real solo resta lo que vence. */
export function CardDebtStat({ debt }: { debt: string }) {
  return (
    <section className={`${ui.card} ${styles.stat}`} aria-label="Tarjetas de crédito">
      <p className={styles.statLabel}>Deuda total en tarjetas</p>
      <p className={styles.statValue}>{formatMoneyCompact(debt)}</p>
    </section>
  );
}
