import { Inject, Injectable } from '@nestjs/common';
import {
  ACCOUNT_REPOSITORY,
  AccountRepository,
  SCHEDULED_EXPENSE_REPOSITORY,
  ScheduledExpense,
  ScheduledExpenseRepository,
  UnknownAccountError,
} from '@finanzas/domain';
import { DEFAULT_CURRENCY } from '../config';
import { parseDay } from '../dates';
import { EntityNotFoundError } from '../errors';
import { EventBus } from '../events/event-bus';
import { LedgerChangedEvent } from '../events/ledger-changed.event';
import { parseMoney } from '../money-parser';
import { ScheduledExpenseView, toScheduledExpenseView } from '../views';
import { CreateScheduledExpenseCommand } from './create-scheduled-expense.use-case';

export type UpdateScheduledExpenseCommand = CreateScheduledExpenseCommand;

@Injectable()
export class UpdateScheduledExpenseUseCase {
  constructor(
    @Inject(SCHEDULED_EXPENSE_REPOSITORY) private readonly scheduled: ScheduledExpenseRepository,
    @Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepository,
    private readonly events: EventBus,
  ) {}

  async execute(id: string, command: UpdateScheduledExpenseCommand): Promise<ScheduledExpenseView> {
    const existing = await this.scheduled.findById(id);
    if (!existing) throw new EntityNotFoundError('Gasto programado', id);

    const updated = ScheduledExpense.create({
      id,
      description: command.description,
      amount: parseMoney(command.amount, command.currency ?? DEFAULT_CURRENCY),
      accountId: command.accountId,
      frequency: command.frequency,
      startDate: parseDay(command.startDate),
      endDate: command.endDate ? parseDay(command.endDate) : undefined,
      settledThrough: existing.settledThrough,
    });
    if (!(await this.accounts.findById(command.accountId))) throw new UnknownAccountError(command.accountId);

    await this.scheduled.save(updated);
    await this.events.publish(new LedgerChangedEvent('scheduled-expense'));
    return toScheduledExpenseView(updated);
  }
}
