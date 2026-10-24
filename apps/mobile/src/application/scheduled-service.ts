import { ScheduledExpense, TransactionFactory, UnknownAccountError, assertDomain } from '@finanzas/domain';
import type { ActionResult, CreateScheduledExpenseInput, ScheduledExpense as ScheduledView } from '@finanzas/ui';
import { notFound, parseDay, parseMoney, writeAction, type ServiceContext } from './support';
import { toScheduledView } from './views';

export class ScheduledService {
  constructor(private readonly ctx: ServiceContext) {}

  async list(): Promise<ScheduledView[]> {
    return (await this.ctx.scheduled.findAll()).map(toScheduledView);
  }

  create(input: CreateScheduledExpenseInput): Promise<ActionResult> {
    return writeAction(this.ctx, async () => {
      const expense = this.build(this.ctx.newId(), input);
      await this.assertAccount(input.accountId);
      await this.ctx.scheduled.save(expense);
    });
  }

  /** Editar conserva lo ya liquidado (settledThrough). */
  update(id: string, input: CreateScheduledExpenseInput): Promise<ActionResult> {
    return writeAction(this.ctx, async () => {
      const existing = await this.ctx.scheduled.findById(id);
      if (!existing) throw notFound('ese gasto programado');
      const expense = this.build(id, input, existing.settledThrough);
      await this.assertAccount(input.accountId);
      await this.ctx.scheduled.save(expense);
    });
  }

  remove(id: string): Promise<ActionResult> {
    return writeAction(this.ctx, async () => {
      if (!(await this.ctx.scheduled.findById(id))) throw notFound('ese gasto programado');
      await this.ctx.scheduled.delete(id);
    });
  }

  /**
   * "Ya lo pagué": registra un gasto real por cada ocurrencia pendiente hasta `through`
   * y marca el programado como liquidado, todo en una sola operación (o nada).
   */
  settle(id: string, through: string): Promise<ActionResult> {
    return writeAction(this.ctx, async () => {
      const upTo = parseDay(through);
      const expense = await this.ctx.scheduled.findById(id);
      if (!expense) throw notFound('ese gasto programado');
      assertDomain(
        !expense.settledThrough || upTo.getTime() > expense.settledThrough.getTime(),
        'El gasto ya está liquidado hasta esa fecha o una posterior',
      );
      const real = expense.pendingOccurrences(expense.startDate, upTo).map((date) =>
        TransactionFactory.create({
          id: this.ctx.newId(),
          type: 'EXPENSE',
          accountId: expense.accountId,
          amount: expense.amount,
          date,
          description: expense.description,
        }),
      );
      await this.ctx.ledger.settle(expense.markSettled(upTo), real);
    });
  }

  private build(id: string, input: CreateScheduledExpenseInput, settledThrough?: Date): ScheduledExpense {
    return ScheduledExpense.create({
      id,
      description: input.description,
      amount: parseMoney(input.amount),
      accountId: input.accountId,
      frequency: input.frequency,
      startDate: parseDay(input.startDate),
      endDate: input.endDate ? parseDay(input.endDate) : undefined,
      settledThrough,
    });
  }

  private async assertAccount(accountId: string): Promise<void> {
    if (!(await this.ctx.accounts.findById(accountId))) throw new UnknownAccountError(accountId);
  }
}
