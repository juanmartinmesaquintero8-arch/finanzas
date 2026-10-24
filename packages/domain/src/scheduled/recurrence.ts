import { addDaysUTC, daysBetween, daysInMonthUTC, isWithin } from '../shared/date';
import { DomainValidationError, assertDomain } from '../shared/domain-validation.error';

export const FREQUENCIES = ['ONCE', 'WEEKLY', 'BIWEEKLY', 'MONTHLY'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

/**
 * Strategy: cada regla sabe generar sus ocurrencias dentro de [from, to] (inclusive)
 * a partir de una fecha ancla. Todas las fechas se esperan normalizadas a 00:00 UTC.
 */
export interface RecurrenceRule {
  occurrences(anchor: Date, from: Date, to: Date): Date[];
}

export class OnceRecurrence implements RecurrenceRule {
  occurrences(anchor: Date, from: Date, to: Date): Date[] {
    return isWithin(anchor, from, to) ? [anchor] : [];
  }
}

export class WeeklyRecurrence implements RecurrenceRule {
  constructor(private readonly intervalWeeks = 1) {
    assertDomain(Number.isInteger(intervalWeeks) && intervalWeeks > 0, 'El intervalo semanal debe ser un entero positivo');
  }

  occurrences(anchor: Date, from: Date, to: Date): Date[] {
    const step = 7 * this.intervalWeeks;
    const skip = Math.max(0, Math.ceil(daysBetween(anchor, from) / step));
    const result: Date[] = [];
    for (let date = addDaysUTC(anchor, skip * step); date.getTime() <= to.getTime(); date = addDaysUTC(date, step)) {
      result.push(date);
    }
    return result;
  }
}

export class MonthlyRecurrence implements RecurrenceRule {
  occurrences(anchor: Date, from: Date, to: Date): Date[] {
    const anchorDay = anchor.getUTCDate();
    const start = from.getTime() > anchor.getTime() ? from : anchor;
    const result: Date[] = [];
    let year = start.getUTCFullYear();
    let month = start.getUTCMonth();

    for (;;) {
      const day = Math.min(anchorDay, daysInMonthUTC(year, month));
      const date = new Date(Date.UTC(year, month, day));
      if (date.getTime() > to.getTime()) break;
      if (isWithin(date, start, to)) result.push(date);
      month += 1;
      if (month === 12) {
        month = 0;
        year += 1;
      }
    }
    return result;
  }
}

export const RecurrenceFactory = {
  create(frequency: Frequency): RecurrenceRule {
    switch (frequency) {
      case 'ONCE':
        return new OnceRecurrence();
      case 'WEEKLY':
        return new WeeklyRecurrence(1);
      case 'BIWEEKLY':
        return new WeeklyRecurrence(2);
      case 'MONTHLY':
        return new MonthlyRecurrence();
      default:
        throw new DomainValidationError(`Frecuencia desconocida: ${String(frequency)}`);
    }
  },
};
