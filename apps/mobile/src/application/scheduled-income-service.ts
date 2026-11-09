import { ScheduledIncome, TransactionFactory, UnknownAccountError } from '@finanzas/domain';
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
   * "Ya lo recibí": registra SOLO la última ocurrencia que ya llegó (hasta `through`) y marca el programado
   * como recibido hasta esa fecha; las anteriores se dan por recibidas sin crear dinero. Es una sola escritura
   * (o nada). El movimiento tiene un id fijo (ingreso + fecha): si la acción se repite a la vez, reescribe lo
   * mismo y no duplica.
   */
  receive(id: string, through: string): Promise<ActionResult> {
    return writeAction(this.ctx, async () => {
      const upTo = parseDay(through);
      const income = await this.ctx.scheduledIncomes.findById(id);
      if (!income) throw notFound('ese ingreso programado');
      const due = income.pendingOccurrences(income.startDate, upTo);
      if (due.length === 0) {
        if (income.settledThrough) throw new AppError('Ese ingreso ya está registrado hasta esa fecha o una posterior');
        throw new AppError('Todavía no llega la fecha de este ingreso.');
      }
      const latest = due[due.length - 1]!;
      const real = TransactionFactory.create({
        id: `${income.id}-${isoDay(latest)}`,
        type: 'INCOME',
        accountId: income.accountId,
        amount: income.amount,
        date: latest,
        description: income.description,
        category: income.category,
      });
      await this.ctx.ledger.receive(income.markSettled(latest), [real]);
      return due.length > 1 ? 'Registramos solo el último; los anteriores se dan por recibidos.' : undefined;
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
