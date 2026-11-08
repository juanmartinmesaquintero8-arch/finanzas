import Link from 'next/link';
import { formatMoneyCompact } from '../lib/format';
import styles from './SpendingBreakdown.module.css';
import ui from './ui.module.css';

interface Props {
  /** Gasto del mes en curso (entero, como texto). */
  total: string;
  href: string;
}

/** Tarjeta pequeña de Inicio: lo gastado este mes y el paso al detalle. */
export function SpendingHomeCard({ total, href }: Props) {
  return (
    <section className={`${ui.card} ${styles.homeCard}`} aria-label="Gasto del mes">
      <p className={styles.homeText}>Este mes gastaste {formatMoneyCompact(total)}</p>
      <Link href={href} className={styles.homeLink}>
        Ver en qué
      </Link>
    </section>
  );
}
