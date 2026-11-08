/** Mes calendario como 'YYYY-MM'. Todo el módulo trabaja con texto: sin zonas horarias ni Date. */
export type MonthKey = string;

/** Cuántos meses hacia atrás se puede mirar (contando el actual). */
export const MAX_SPENDING_MONTHS = 24;

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export const isMonthKey = (value: unknown): value is MonthKey => typeof value === 'string' && MONTH.test(value);

function split(key: MonthKey): { y: number; m: number } {
  const [y, m] = key.split('-').map(Number) as [number, number];
  return { y, m };
}

const join = (y: number, m: number): MonthKey => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;

export function addMonths(key: MonthKey, months: number): MonthKey {
  const { y, m } = split(key);
  const index = y * 12 + (m - 1) + months;
  return join(Math.floor(index / 12), (index % 12) + 1);
}

export function daysInMonth(key: MonthKey): number {
  const { y, m } = split(key);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Primer y último mes que se pueden consultar, a partir de hoy (YYYY-MM-DD). */
export function spendingWindow(today: string): { current: MonthKey; oldest: MonthKey } {
  const current = today.slice(0, 7);
  return { current, oldest: addMonths(current, -(MAX_SPENDING_MONTHS - 1)) };
}

/** Deja el mes pedido dentro de la ventana; un valor inválido cae en el mes actual. */
export function clampSpendingMonth(raw: string | null | undefined, today: string): MonthKey {
  const { current, oldest } = spendingWindow(today);
  if (!isMonthKey(raw)) return current;
  if (raw > current) return current;
  if (raw < oldest) return oldest;
  return raw;
}
