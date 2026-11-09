import type { Frequency, MoneyView } from './types';

const TZ = 'America/Bogota';

/** Agrupa dígitos de a tres con punto: "1234567" -> "1.234.567". */
function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** `$ 1.234.567` (es-CO, sin decimales). Acepta bigint o el entero-string de la API. */
export function formatMoney(value: bigint | string): string {
  const n = typeof value === 'bigint' ? value : BigInt(value);
  const abs = n < 0n ? -n : n;
  return `${n < 0n ? '-' : ''}$ ${group(abs.toString())}`;
}

/** `$2.450.000` (sin espacio), para frases como "Gastaste $2.450.000". */
export function formatMoneyCompact(value: bigint | string): string {
  return formatMoney(value).replace('$ ', '$');
}

export function formatMoneyView(m: MoneyView): string {
  return formatMoney(m.amount);
}

/** Formatea en vivo lo que escribe el usuario: sólo dígitos, agrupados por miles. */
export function formatGroupedDigits(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  return group(digits.replace(/^0+(?=\d)/, ''));
}

/** Convierte el texto del campo a entero-string para la API; null si vacío, inválido o cero. */
export function parseAmountInput(raw: string): string | null {
  const digits = raw.replace(/\D/g, '').replace(/^0+/, '');
  return digits === '' ? null : digits;
}

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** Día calendario (YYYY-MM-DD) de `now` en hora de Colombia. */
export function todayISO(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function parts(day: string): { y: number; m: number; d: number; dow: number } {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number) as [number, number, number];
  return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

export function addDays(day: string, days: number): string {
  const { y, m, d } = parts(day);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Último día del mes de `day`. */
export function endOfMonthISO(day: string): string {
  const { y, m } = parts(day);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Suma meses acotando el día al último del mes destino. */
export function addMonthsISO(day: string, months: number): string {
  const { y, m, d } = parts(day);
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, last))).toISOString().slice(0, 10);
}

export function formatDayHeading(day: string, now: Date = new Date()): string {
  const today = todayISO(now);
  const key = day.slice(0, 10);
  if (key === today) return 'Hoy';
  if (key === addDays(today, -1)) return 'Ayer';
  const { y, m, d, dow } = parts(key);
  const base = `${WEEKDAYS[dow]} ${d} de ${MONTHS[m - 1]}`;
  return y === parts(today).y ? base : `${base} de ${y}`;
}

/** Nombre del mes en minúsculas: '2026-11' -> 'noviembre'. */
export function monthName(month: string): string {
  return MONTHS[Number(month.slice(5, 7)) - 1] ?? '';
}

/** 'Noviembre 2026'. */
export function formatMonthTitle(month: string): string {
  const name = monthName(month);
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${month.slice(0, 4)}`;
}

/** Fecha corta: "5 mar 2026". */
export function formatShortDate(day: string): string {
  const { y, m, d } = parts(day);
  return `${d} ${MONTHS[m - 1]!.slice(0, 3)} ${y}`;
}

/** "15 dic" si es del año de `today`; si no, "15 nov 2027". */
export function formatDueDate(day: string, today: string): string {
  const { y, m, d } = parts(day);
  const short = `${d} ${MONTHS[m - 1]!.slice(0, 3)}`;
  return y === parts(today).y ? short : `${short} ${y}`;
}

/** "lunes 30 de marzo": el día de la semana, el número y el mes (sin "hoy" ni "ayer"). */
export function formatWeekdayDate(day: string): string {
  const { m, d, dow } = parts(day);
  return `${WEEKDAYS[dow]} ${d} de ${MONTHS[m - 1]}`;
}

export function frequencyLabel(frequency: Frequency, startDate: string): string {
  const { d, dow } = parts(startDate);
  switch (frequency) {
    case 'MONTHLY':
      return `Cada mes, día ${d}`;
    case 'WEEKLY':
      return `Cada semana, ${WEEKDAYS[dow]}`;
    case 'BIWEEKLY':
      return `Cada 2 semanas, ${WEEKDAYS[dow]}`;
    case 'ONCE':
      return 'Una sola vez';
  }
}
