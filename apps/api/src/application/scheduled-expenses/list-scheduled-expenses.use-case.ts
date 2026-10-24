import { Inject, Injectable } from '@nestjs/common';
import { SCHEDULED_EXPENSE_REPOSITORY, ScheduledExpenseRepository } from '@finanzas/domain';
import { ScheduledExpenseView, toScheduledExpenseView } from '../views';

@Injectable()
export class ListScheduledExpensesUseCase {
  constructor(@Inject(SCHEDULED_EXPENSE_REPOSITORY) private readonly scheduled: ScheduledExpenseRepository) {}

  async execute(): Promise<ScheduledExpenseView[]> {
    return (await this.scheduled.findAll()).map(toScheduledExpenseView);
  }
}
