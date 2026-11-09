import Link from 'next/link';
import { formatMoneyCompact, formatMonthTitle, monthName } from '../lib/format';
import type { SpendingRowView, SpendingView } from '../lib/types';
import styles from './SpendingBreakdown.module.css';
import ui from './ui.module.css';

interface Props {
  view: SpendingView;
  /** Enlace a la vista de gasto de otro mes ('YYYY-MM'). */
  monthHref: (month: string) => string;
  /** Enlace al historial de una categoría en el mes mostrado (clave de la fila). */
  rowHref: (categoryKey: string) => string;
}

/** Quita el signo: el sentido ya lo dice la palabra "más" o "menos". */
const magnitude = (delta: string): bigint => {
  const n = BigInt(delta);
  return n < 0n ? -n : n;
};

/**
 * Frase de comparación sin flecha: "$80.000 más que en octubre", "Igual que en octubre"
 * o, en el mes en curso, "... que a este mismo día en octubre".
 */
function comparison(delta: string, previousMonth: string, sameDay: boolean): string {
  const than = `que ${sameDay ? 'a este mismo día en' : 'en'} ${monthName(previousMonth)}`;
  const n = BigInt(delta);
  if (n === 0n) return `Igual ${than}`;
  return `${formatMoneyCompact(magnitude(delta))} ${n > 0n ? 'más' : 'menos'} ${than}`;
}

const ARROW = (delta: string): string => (BigInt(delta) > 0n ? '↑ ' : BigInt(delta) < 0n ? '↓ ' : '');

const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

function rowComparison(row: SpendingRowView, view: SpendingView): { visible: string | null; spoken: string | null } {
  if (row.isNew) return { visible: 'Nuevo este mes', spoken: 'nuevo este mes' };
  if (row.delta === null) return { visible: null, spoken: null };
  const text = comparison(row.delta, view.previousMonth, view.isCurrent);
  return { visible: `${ARROW(row.delta)}${text}`, spoken: lowerFirst(text) };
}

function MonthNav({ view, monthHref }: Pick<Props, 'view' | 'monthHref'>) {
  const previous = view.month > view.oldestMonth ? view.previousMonth : null;
  const next = view.month < view.currentMonth ? nextMonth(view.month) : null;
  return (
    <nav className={styles.monthNav} aria-label="Mes">
      {previous ? (
        <Link href={monthHref(previous)} className={styles.step} aria-label={`Mes anterior: ${monthName(previous)} ${previous.slice(0, 4)}`} replace>
          <span aria-hidden="true">‹</span>
        </Link>
      ) : (
        <span role="link" aria-disabled="true" aria-label="Mes anterior" className={`${styles.step} ${styles.stepOff}`}>
          <span aria-hidden="true">‹</span>
        </span>
      )}
      <h2 className={styles.month}>{formatMonthTitle(view.month)}</h2>
      {next ? (
        <Link href={monthHref(next)} className={styles.step} aria-label={`Mes siguiente: ${monthName(next)} ${next.slice(0, 4)}`} replace>
          <span aria-hidden="true">›</span>
        </Link>
      ) : (
        <span role="link" aria-disabled="true" aria-label="Mes siguiente" className={`${styles.step} ${styles.stepOff}`}>
          <span aria-hidden="true">›</span>
        </span>
      )}
    </nav>
  );
}

function nextMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

function Row({ row, view, rowHref }: { row: SpendingRowView; view: SpendingView; rowHref: Props['rowHref'] }) {
  const money = formatMoneyCompact(row.amount);
  const cmp = rowComparison(row, view);
  const spoken = [row.label, money, `${row.percent} % del gasto`, cmp.spoken].filter(Boolean).join(', ');
  const muted = row.kind !== 'category';

  const body = (
    <>
      <span className="sr-only">{spoken}</span>
      <span className={styles.visual} aria-hidden="true">
        <span className={styles.line}>
          <span className={styles.name}>{row.label}</span>
          <span className={styles.amount}>{money}</span>
        </span>
        <span className={styles.track}>
          <span className={`${styles.fill} ${muted ? styles.fillMuted : ''}`} data-bar style={{ width: `${row.barPct}%` }} />
          {row.previousMarkPct !== null && <span className={styles.mark} data-mark style={{ left: `${row.previousMarkPct}%` }} />}
        </span>
        <span className={styles.line}>
          <span className={styles.compare}>{cmp.visible}</span>
          <span className={styles.share}>{row.percent} %</span>
        </span>
      </span>
    </>
  );

  return (
    <li className={styles.item}>
      {row.kind === 'other' ? (
        <div className={styles.row}>{body}</div>
      ) : (
        <Link href={rowHref(row.key)} className={`${styles.row} ${styles.rowLink}`}>
          {body}
        </Link>
      )}
    </li>
  );
}

/** "En qué gasto": cuánto se fue en el mes y en qué, con barras de un solo color y la comparación con el mes anterior. */
export function SpendingBreakdown({ view, monthHref, rowHref }: Props) {
  const month = monthName(view.month);
  const empty = view.rows.length === 0;
  const totalComparison =
    view.totalDelta !== null
      ? `${ARROW(view.totalDelta)}${comparison(view.totalDelta, view.previousMonth, view.isCurrent)}`
      : `No hay gastos de ${monthName(view.previousMonth)} con qué comparar.`;

  return (
    <section className={ui.stack} aria-label="En qué gasto">
      <MonthNav view={view} monthHref={monthHref} />

      {empty ? (
        <p className={ui.empty}>Todavía no hay gastos en {month}. Cuando registres uno, aquí verás en qué se va tu plata.</p>
      ) : (
        <>
          <div className={styles.headline}>
            <p className={styles.total}>{`Gastaste ${formatMoneyCompact(view.total)} en ${month}`}</p>
            <p className={styles.totalCompare}>{totalComparison}</p>
          </div>
          <ul className={`${ui.card} ${styles.list}`} aria-label="Gasto por categoría">
            {view.rows.map((row) => (
              <Row key={row.key} row={row} view={view} rowHref={rowHref} />
            ))}
          </ul>
          <p className={styles.note}>No incluye traspasos entre tus cuentas.</p>
        </>
      )}
    </section>
  );
}
