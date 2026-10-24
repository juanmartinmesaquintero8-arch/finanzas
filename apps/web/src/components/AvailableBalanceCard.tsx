import Link from 'next/link';
import { HORIZONS, type Horizon } from '@/lib/domain-helpers';
import { formatMoneyView } from '@/lib/format';
import type { Projection } from '@/lib/types';
import styles from './AvailableBalanceCard.module.css';
import ui from './ui.module.css';

interface Props {
  projection: Pick<Projection, 'availableBalance' | 'netWorth' | 'committed' | 'isShortfall'>;
  horizon: Horizon;
}

export function AvailableBalanceCard({ projection, horizon }: Props) {
  const { availableBalance, netWorth, committed, isShortfall } = projection;
  return (
    <section className={`${styles.hero} ${isShortfall ? styles.short : ''}`} aria-labelledby="available-title">
      <h2 id="available-title" className={styles.title}>
        Saldo Real Disponible
      </h2>
      <p className={styles.amount}>{formatMoneyView(availableBalance)}</p>

      {isShortfall && (
        <p role="alert" className={styles.alert}>
          Ojo: con tus compromisos programados no te alcanza el dinero.
        </p>
      )}

      <dl className={styles.stats}>
        <div>
          <dt>Patrimonio total</dt>
          <dd>{formatMoneyView(netWorth)}</dd>
        </div>
        <div>
          <dt>Comprometido</dt>
          <dd>{formatMoneyView(committed)}</dd>
        </div>
      </dl>

      <div className={ui.chips} role="group" aria-label="Horizonte de compromisos">
        {HORIZONS.map((h) => (
          <Link
            key={h.value}
            href={`/?h=${h.value}`}
            className={`${ui.chip} ${styles.horizonChip}`}
            aria-current={h.value === horizon ? 'true' : undefined}
            replace
          >
            {h.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
