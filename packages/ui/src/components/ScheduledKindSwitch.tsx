import Link from 'next/link';
import styles from './SpendingBreakdown.module.css';
import ui from './ui.module.css';

interface Props {
  active: 'expenses' | 'incomes';
  expensesHref: string;
  incomesHref: string;
}

/** Selector de arriba de Programados: "Gastos" o "Ingresos". */
export function ScheduledKindSwitch({ active, expensesHref, incomesHref }: Props) {
  return (
    <div className={`${ui.chips} ${styles.switch}`} role="group" aria-label="Tipo">
      <Link href={expensesHref} className={ui.chip} aria-current={active === 'expenses' ? 'true' : undefined} replace>
        Gastos
      </Link>
      <Link href={incomesHref} className={ui.chip} aria-current={active === 'incomes' ? 'true' : undefined} replace>
        Ingresos
      </Link>
    </div>
  );
}
