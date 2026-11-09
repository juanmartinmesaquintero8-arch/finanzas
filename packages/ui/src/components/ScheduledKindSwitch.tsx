import Link from 'next/link';
import styles from './SpendingBreakdown.module.css';
import ui from './ui.module.css';

interface Props {
  active: 'expenses' | 'incomes' | 'cards';
  expensesHref: string;
  incomesHref: string;
  /** Solo la app móvil tiene tarjetas. */
  cardsHref?: string;
}

/** Selector de arriba de Programados: "Gastos", "Ingresos" y, si se pasa su enlace, "Tarjetas". */
export function ScheduledKindSwitch({ active, expensesHref, incomesHref, cardsHref }: Props) {
  return (
    <div className={`${ui.chips} ${styles.switch}`} role="group" aria-label="Tipo de programado">
      <Link href={expensesHref} className={ui.chip} aria-current={active === 'expenses' ? 'true' : undefined} replace>
        Gastos
      </Link>
      <Link href={incomesHref} className={ui.chip} aria-current={active === 'incomes' ? 'true' : undefined} replace>
        Ingresos
      </Link>
      {cardsHref && (
        <Link href={cardsHref} className={ui.chip} aria-current={active === 'cards' ? 'true' : undefined} replace>
          Tarjetas
        </Link>
      )}
    </div>
  );
}
