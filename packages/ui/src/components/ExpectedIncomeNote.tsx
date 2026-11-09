import { formatMoney, formatMoneyView, formatWeekdayDate } from '../lib/format';
import type { MoneyView } from '../lib/types';
import styles from './ExpectedIncomeNote.module.css';

interface Props {
  expectedIncome?: MoneyView;
  availableWithIncome?: MoneyView;
  lowestWithIncome?: { date: string; balance: MoneyView };
  lastExpectedIncomeDate?: string;
}

/**
 * Línea secundaria de Inicio, debajo del Saldo Real Disponible: lo que habría si llega lo esperado.
 * Solo aparece si hay ingresos esperados en el horizonte; nunca cambia el saldo real.
 */
export function ExpectedIncomeNote({ expectedIncome, availableWithIncome, lowestWithIncome, lastExpectedIncomeDate }: Props) {
  if (!expectedIncome || !availableWithIncome || BigInt(expectedIncome.amount) <= 0n) return null;
  const lowest = lowestWithIncome ? BigInt(lowestWithIncome.balance.amount) : 0n;
  // Solo se dice "antes de que llegue" si el punto más bajo es de un día anterior al último ingreso esperado
  // (el mismo día el ingreso se aplica primero, así que ya llegó).
  const beforeIncome = !!lowestWithIncome && !!lastExpectedIncomeDate && lowestWithIncome.date < lastExpectedIncomeDate;
  return (
    <section className={styles.note} aria-label="Ingresos esperados">
      <p className={styles.line}>Si llega lo que esperas recibir: {formatMoneyView(availableWithIncome)}</p>
      {lowestWithIncome && lowest < 0n && (
        <p className={styles.warning}>
          Ojo: el {formatWeekdayDate(lowestWithIncome.date)} te faltarían {formatMoney(-lowest)}{' '}
          {beforeIncome ? 'antes de que llegue lo que esperas.' : 'según lo programado.'}
        </p>
      )}
    </section>
  );
}
