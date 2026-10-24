import { Money } from '../money/money';
import { addDaysUTC, startOfDayUTC } from '../shared/date';
import { assertDomain } from '../shared/domain-validation.error';
import { Frequency, RecurrenceFactory, RecurrenceRule } from './recurrence';

export interface ScheduledExpenseProps {
  id: string;
  description: string;
  amount: Money;
  accountId: string;
  frequency: Frequency;
  startDate: Date;
  endDate?: Date;
  /** Última fecha de ocurrencia ya pagada (registrada como transacción real). */
  settledThrough?: Date;
}

/** Compromiso futuro (único o recurrente) que reduce el Saldo Real Disponible. */
export class ScheduledExpense {
  private readonly rule: RecurrenceRule;

  private constructor(
    readonly id: string,
    readonly description: string,
    readonly amount: Money,
    readonly accountId: string,
    readonly frequency: Frequency,
    readonly startDate: Date,
    readonly endDate?: Date,
    readonly settledThrough?: Date,
  ) {
    this.rule = RecurrenceFactory.create(frequency);
  }

  static create(props: ScheduledExpenseProps): ScheduledExpense {
    const description = props.description.trim();
    assertDomain(description.length > 0, 'La descripción del gasto programado es obligatoria');
    assertDomain(props.amount.isPositive(), 'El monto del gasto programado debe ser mayor que cero');
    const startDate = startOfDayUTC(props.startDate);
    const endDate = props.endDate && startOfDayUTC(props.endDate);
    assertDomain(!endDate || endDate.getTime() >= startDate.getTime(), 'La fecha de fin no puede ser anterior al inicio');
    return new ScheduledExpense(
      props.id,
      description,
      props.amount,
      props.accountId,
      props.frequency,
      startDate,
      endDate,
      props.settledThrough && startOfDayUTC(props.settledThrough),
    );
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

  markSettled(through: Date): ScheduledExpense {
    return ScheduledExpense.create({ ...this.toProps(), settledThrough: through });
  }

  toProps(): ScheduledExpenseProps {
    return {
      id: this.id,
      description: this.description,
      amount: this.amount,
      accountId: this.accountId,
      frequency: this.frequency,
      startDate: this.startDate,
      endDate: this.endDate,
      settledThrough: this.settledThrough,
    };
  }
}
