import { addDaysUTC, startOfDayUTC } from '../shared/date';
import { assertDomain } from '../shared/domain-validation.error';
import { Frequency, RecurrenceFactory, RecurrenceRule } from './recurrence';

export interface ScheduleProps {
  frequency: Frequency;
  startDate: Date;
  endDate?: Date;
  /** Última fecha de ocurrencia ya liquidada (registrada como transacción real). */
  settledThrough?: Date;
}

/**
 * Calendario de un compromiso o de un ingreso esperado: cuándo ocurre, hasta cuándo y qué ya se liquidó.
 * Es interno al dominio: lo comparten ScheduledExpense y ScheduledIncome sin heredar uno del otro.
 */
export class Schedule {
  private readonly rule: RecurrenceRule;

  private constructor(
    readonly frequency: Frequency,
    readonly startDate: Date,
    readonly endDate?: Date,
    readonly settledThrough?: Date,
  ) {
    this.rule = RecurrenceFactory.create(frequency);
  }

  static create(props: ScheduleProps): Schedule {
    const startDate = startOfDayUTC(props.startDate);
    const endDate = props.endDate && startOfDayUTC(props.endDate);
    assertDomain(!endDate || endDate.getTime() >= startDate.getTime(), 'La fecha de fin no puede ser anterior al inicio');
    return new Schedule(props.frequency, startDate, endDate, props.settledThrough && startOfDayUTC(props.settledThrough));
  }

  /** Ocurrencias aún no liquidadas dentro de [from, to]. */
  pendingOccurrences(from: Date, to: Date): Date[] {
    let lower = startOfDayUTC(from);
    if (this.settledThrough && this.settledThrough.getTime() >= lower.getTime()) {
      lower = addDaysUTC(this.settledThrough, 1);
    }
    let upper = startOfDayUTC(to);
    if (this.endDate && this.endDate.getTime() < upper.getTime()) upper = this.endDate;
    if (lower.getTime() > upper.getTime()) return [];
    return this.rule.occurrences(this.startDate, lower, upper);
  }

  settle(through: Date): Schedule {
    return Schedule.create({ ...this.toProps(), settledThrough: through });
  }

  toProps(): ScheduleProps {
    return { frequency: this.frequency, startDate: this.startDate, endDate: this.endDate, settledThrough: this.settledThrough };
  }
}
