import { Money } from '../money/money';
import { assertDomain } from '../shared/domain-validation.error';
import { Frequency } from './recurrence';
import { Schedule } from './schedule';

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
  /** Categoría que llevará el gasto real al liquidarlo (opcional). */
  category?: string;
}

/** Compromiso futuro (único o recurrente) que reduce el Saldo Real Disponible. */
export class ScheduledExpense {
  private readonly schedule: Schedule;

  private constructor(
    readonly id: string,
    readonly description: string,
    readonly amount: Money,
    readonly accountId: string,
    schedule: Schedule,
    readonly category?: string,
  ) {
    this.schedule = schedule;
  }

  static create(props: ScheduledExpenseProps): ScheduledExpense {
    const description = props.description.trim();
    assertDomain(description.length > 0, 'La descripción del gasto programado es obligatoria');
    assertDomain(props.amount.isPositive(), 'El monto del gasto programado debe ser mayor que cero');
    return new ScheduledExpense(
      props.id,
      description,
      props.amount,
      props.accountId,
      Schedule.create(props),
      props.category?.trim() || undefined,
    );
  }

  get frequency(): Frequency {
    return this.schedule.frequency;
  }
  get startDate(): Date {
    return this.schedule.startDate;
  }
  get endDate(): Date | undefined {
    return this.schedule.endDate;
  }
  get settledThrough(): Date | undefined {
    return this.schedule.settledThrough;
  }

  /** Ocurrencias aún no liquidadas dentro de [from, to]. */
  pendingOccurrences(from: Date, to: Date): Date[] {
    return this.schedule.pendingOccurrences(from, to);
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
      ...this.schedule.toProps(),
      category: this.category,
    };
  }
}
