import { Inject, Injectable } from '@nestjs/common';
import { TRANSACTION_REPOSITORY, TransactionRepository } from '@finanzas/domain';
import { EntityNotFoundError } from '../errors';
import { EventBus } from '../events/event-bus';
import { LedgerChangedEvent } from '../events/ledger-changed.event';

@Injectable()
export class DeleteTransactionUseCase {
  constructor(
    @Inject(TRANSACTION_REPOSITORY) private readonly transactions: TransactionRepository,
    private readonly events: EventBus,
  ) {}

  async execute(id: string): Promise<void> {
    if (!(await this.transactions.findById(id))) throw new EntityNotFoundError('Transacción', id);
    await this.transactions.delete(id);
    await this.events.publish(new LedgerChangedEvent('transaction'));
  }
}
