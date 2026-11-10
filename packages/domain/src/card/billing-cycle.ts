import { daysInMonthUTC } from '../shared/date';

/** Fecha con el día `day` (ajustado a fin de mes) del mes `month` (0-11, admite desbordes) del año `year`. */
export function dateInMonth(year: number, month: number, day: number): Date {
  const normalizedYear = year + Math.floor(month / 12);
  const normalizedMonth = ((month % 12) + 12) % 12;
  return new Date(Date.UTC(normalizedYear, normalizedMonth, Math.min(day, daysInMonthUTC(normalizedYear, normalizedMonth))));
}

/** Mes absoluto (año·12 + mes 0-11) de una fecha. */
export function monthIndexOf(date: Date): number {
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

function inMonthIndex(index: number, day: number): Date {
  return dateInMonth(Math.floor(index / 12), index % 12, day);
}

/** Primer corte (día ajustado a fin de mes) en la fecha dada o después. */
export function cutOnOrAfter(date: Date, cutDay: number): Date {
  const index = monthIndexOf(date);
  const thisMonth = inMonthIndex(index, cutDay);
  return thisMonth.getTime() >= date.getTime() ? thisMonth : inMonthIndex(index + 1, cutDay);
}

/** Primer día de pago (ajustado a fin de mes) estrictamente posterior a `date`. */
export function dueAfter(date: Date, dueDay: number): Date {
  const index = monthIndexOf(date);
  const thisMonth = inMonthIndex(index, dueDay);
  return thisMonth.getTime() > date.getTime() ? thisMonth : inMonthIndex(index + 1, dueDay);
}

/** Mes (índice absoluto) del ciclo de facturación al que pertenece una fecha: del día siguiente al corte anterior hasta el corte. */
export function cycleMonthIndex(date: Date, cutDay: number): number {
  return monthIndexOf(cutOnOrAfter(date, cutDay));
}

/** Vencimiento de la cuota de manejo del mes `monthIndex`: sin corte, el día de pago del mes siguiente; con corte, el primer día de pago posterior al corte de ese mes. */
export function feeDueDate(monthIndex: number, dueDay: number, cutDay?: number): Date {
  if (cutDay === undefined) return inMonthIndex(monthIndex + 1, dueDay);
  return dueAfter(inMonthIndex(monthIndex, cutDay), dueDay);
}
