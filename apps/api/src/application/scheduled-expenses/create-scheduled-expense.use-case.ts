import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  ACCOUNT_REPOSITORY,
  AccountRepository,
  Frequency,
  SCHEDULED_EXPENSE_REPOSITORY,
  ScheduledExpense,
  ScheduledExpenseRepository,
  UnknownAccountError,
} from '@finanzas/domain';
import { DEFAULT_CURRENCY } from '../config';
import { parseDay } from '../dates';
import { EventBus } from '../events/event-bus';
import { LedgerChangedEvent } from '../events/ledger-changed.event';
import { parseMoney } from '../money-parser';
import { ScheduledExpenseView, toScheduledExpenseView } from '../views';

export interface CreateScheduledExpenseCommand {
  description: string;
  amount: string;
  currency?: string;
  accountId: string;
  frequency: Frequency;
  startDate: string;
  endDate?: string;
}

@Injectable()
export class CreateScheduledExpenseUseCase {
  constructor(
    @Inject(SCHEDULED_EXPENSE_REPOSITORY) private readonly scheduled: ScheduledExpenseRepository,
    @Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepository,
    private readonly events: EventBus,
  ) {}

  async execute(command: CreateScheduledExpenseCommand): Promise<ScheduledExpenseView> {
    const expense = ScheduledExpense.create({
      id: randomUUID(),
      description: command.description,
      amount: parseMoney(command.amount, command.currency ?? DEFAULT_CURRENCY),
      accountId: command.accountId,
      frequency: command.frequency,
      startDate: parseDay(command.startDate),
      endDate: command.endDate ? parseDay(command.endDate) : undefined,
    });
    if (!(await this.accounts.findById(command.accountId))) throw new UnknownAccountError(command.accountId);

    await this.scheduled.save(expense);
    await this.events.publish(new LedgerChangedEvent('scheduled-expense'));
    return toScheduledExpenseView(expense);
  }
}
