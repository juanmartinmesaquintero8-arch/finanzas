import Link from 'next/link';
import styles from './SpendingBreakdown.module.css';
import ui from './ui.module.css';

interface Props {
  active: 'movements' | 'spending';
  movementsHref: string;
  spendingHref: string;
}

/** Selector de arriba del Historial: "Movimientos" o "En qué gasto". */
export function HistoryViewSwitch({ active, movementsHref, spendingHref }: Props) {
  return (
    <div className={`${ui.chips} ${styles.switch}`} role="group" aria-label="Vista">
      <Link href={movementsHref} className={ui.chip} aria-current={active === 'movements' ? 'true' : undefined} replace>
        Movimientos
      </Link>
      <Link href={spendingHref} className={ui.chip} aria-current={active === 'spending' ? 'true' : undefined} replace>
        En qué gasto
      </Link>
    </div>
  );
}
