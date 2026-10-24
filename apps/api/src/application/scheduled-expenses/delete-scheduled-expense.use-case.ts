import { Inject, Injectable } from '@nestjs/common';
import { SCHEDULED_EXPENSE_REPOSITORY, ScheduledExpenseRepository } from '@finanzas/domain';
import { EntityNotFoundError } from '../errors';
import { EventBus } from '../events/event-bus';
import { LedgerChangedEvent } from '../events/ledger-changed.event';

@Injectable()
export class DeleteScheduledExpenseUseCase {
  constructor(
    @Inject(SCHEDULED_EXPENSE_REPOSITORY) private readonly scheduled: ScheduledExpenseRepository,
    private readonly events: EventBus,
  ) {}

  async execute(id: string): Promise<void> {
    if (!(await this.scheduled.findById(id))) throw new EntityNotFoundError('Gasto programado', id);
    await this.scheduled.delete(id);
    await this.events.publish(new LedgerChangedEvent('scheduled-expense'));
  }
}
