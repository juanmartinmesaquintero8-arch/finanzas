import { ScheduledIncome, TransactionFactory, UnknownAccountError, assertDomain } from '@finanzas/domain';
import type { ActionResult, CreateScheduledIncomeInput, ScheduledIncome as ScheduledIncomeView } from '@finanzas/ui';
import { AppError, assertTextLength, isoDay, notFound, parseDay, parseMoney, writeAction, type ServiceContext } from './support';
import { toScheduledIncomeView } from './views';

export class ScheduledIncomeService {
  constructor(private readonly ctx: ServiceContext) {}

  async list(): Promise<ScheduledIncomeView[]> {
    return (await this.ctx.scheduledIncomes.findAll()).map(toScheduledIncomeView);
  }

  create(input: CreateScheduledIncomeInput): Promise<ActionResult> {
    return writeAction(this.ctx, async () => {
      const income = this.build(this.ctx.newId(), input);
      await this.assertAccount(input.accountId);
      await this.ctx.scheduledIncomes.save(income);
    });
  }

  /** Editar conserva lo ya recibido (settledThrough). */
  update(id: string, input: CreateScheduledIncomeInput): Promise<ActionResult> {
    return writeAction(this.ctx, async () => {
      const existing = await this.ctx.scheduledIncomes.findById(id);
      if (!existing) throw notFound('ese ingreso programado');
      const income = this.build(id, input, existing.settledThrough);
      await this.assertAccount(input.accountId);
      await this.ctx.scheduledIncomes.save(income);
    });
  }

  remove(id: string): Promise<ActionResult> {
    return writeAction(this.ctx, async () => {
      if (!(await this.ctx.scheduledIncomes.findById(id))) throw notFound('ese ingreso programado');
      await this.ctx.scheduledIncomes.delete(id);
    });
  }

  /**
   * "Ya lo recibí": registra un ingreso real por cada ocurrencia que ya llegó hasta `through` y marca el
   * programado como recibido, todo en una sola escritura (o nada). Cada movimiento tiene un id fijo
   * (ingreso + fecha): si la misma acción se repite a la vez, reescribe lo mismo y no duplica.
   */
  receive(id: string, through: string): Promise<ActionResult> {
    return writeAction(this.ctx, async () => {
      const upTo = parseDay(through);
      const income = await this.ctx.scheduledIncomes.findById(id);
      if (!income) throw notFound('ese ingreso programado');
      assertDomain(
        !income.settledThrough || upTo.getTime() > income.settledThrough.getTime(),
        'Ese ingreso ya está registrado hasta esa fecha o una posterior',
      );
      const due = income.pendingOccurrences(income.startDate, upTo);
      if (due.length === 0) throw new AppError('Todavía no llega la fecha de este ingreso.');
      const real = due.map((date) =>
        TransactionFactory.create({
          id: `${income.id}-${isoDay(date)}`,
          type: 'INCOME',
          accountId: income.accountId,
          amount: income.amount,
          date,
          description: income.description,
          category: income.category,
        }),
      );
      await this.ctx.ledger.receive(income.markSettled(upTo), real);
    });
  }

  private build(id: string, input: CreateScheduledIncomeInput, settledThrough?: Date): ScheduledIncome {
    assertTextLength('description', input.description);
    assertTextLength('category', input.category);
    return ScheduledIncome.create({
      id,
      description: input.description,
      amount: parseMoney(input.amount),
      accountId: input.accountId,
      frequency: input.frequency,
      startDate: parseDay(input.startDate),
      endDate: input.endDate ? parseDay(input.endDate) : undefined,
      settledThrough,
      category: input.category,
    });
  }

  private async assertAccount(accountId: string): Promise<void> {
    if (!(await this.ctx.accounts.findById(accountId))) throw new UnknownAccountError(accountId);
  }
}
