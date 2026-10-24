import { addDays, addMonthsISO, endOfMonthISO } from './format';
import type { Frequency, ScheduledExpense, Transaction } from './types';

export type Horizon = 'month' | '30d' | '3m';

export const HORIZONS: { value: Horizon; label: string }[] = [
  { value: 'month', label: 'Fin de mes' },
  { value: '30d', label: '30 días' },
  { value: '3m', label: '3 meses' },
];

export function isHorizon(value: unknown): value is Horizon {
  return value === 'month' || value === '30d' || value === '3m';
}

/** Fecha de corte (YYYY-MM-DD) para cada horizonte, a partir de hoy. */
export function horizonEnd(horizon: Horizon, today: string): string {
  switch (horizon) {
    case 'month':
      return endOfMonthISO(today);
    case '30d':
      return addDays(today, 30);
    case '3m':
      return addMonthsISO(today, 3);
  }
}

export interface DayGroup {
  day: string;
  items: Transaction[];
}

/** Agrupa movimientos (ya ordenados) por día calendario conservando el orden. */
export function groupTransactionsByDay(items: Transaction[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const t of items) {
    const day = t.date.slice(0, 10);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(t);
    else groups.push({ day, items: [t] });
  }
  return groups;
}

/** Título del movimiento: cuenta, o "Origen → Destino" en transferencias. */
export function transactionTitle(t: Transaction, names: ReadonlyMap<string, string>): string {
  const name = (id: string | null) => (id ? (names.get(id) ?? 'Cuenta') : 'Cuenta');
  return t.type === 'TRANSFER' ? `${name(t.fromAccountId)} → ${name(t.toAccountId)}` : name(t.accountId);
}

type Schedule = Pick<ScheduledExpense, 'frequency' | 'startDate' | 'endDate' | 'settledThrough'>;

function occurrence(frequency: Frequency, start: string, k: number): string {
  switch (frequency) {
    case 'WEEKLY':
      return addDays(start, 7 * k);
    case 'BIWEEKLY':
      return addDays(start, 14 * k);
    case 'MONTHLY':
      return addMonthsISO(start, k);
    case 'ONCE':
      return start;
  }
}

/** Próximo pago pendiente (sólo para mostrar; el cálculo financiero vive en la API). */
export function nextOccurrence(s: Schedule, today: string): string | null {
  if (s.frequency === 'ONCE') {
    return s.settledThrough && s.settledThrough >= s.startDate ? null : s.startDate;
  }
  for (let k = 0; k < 2000; k++) {
    const date = occurrence(s.frequency, s.startDate, k);
    if (s.endDate && date > s.endDate) return null;
    if (date >= today && (!s.settledThrough || date > s.settledThrough)) return date;
  }
  return null;
}
