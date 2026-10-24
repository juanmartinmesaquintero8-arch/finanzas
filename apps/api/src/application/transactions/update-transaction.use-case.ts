import { Inject, Injectable } from '@nestjs/common';
import {
  ACCOUNT_REPOSITORY,
  AccountRepository,
  TRANSACTION_REPOSITORY,
  TransactionFactory,
  TransactionRepository,
} from '@finanzas/domain';
import { EntityNotFoundError } from '../errors';
import { EventBus } from '../events/event-bus';
import { LedgerChangedEvent } from '../events/ledger-changed.event';
import { TransactionView, toTransactionView } from '../views';
import { TransactionCommand, assertAccountsExist, toFactoryInput } from './transaction-input';

export type UpdateTransactionCommand = TransactionCommand;

/**
 * Reemplaza una transacción: se reconstruye con la Factory (mismo id) para que se apliquen
 * todas las invariantes, incluso si cambia el tipo. Nunca se muta la entidad existente.
 */
@Injectable()
export class UpdateTransactionUseCase {
  constructor(
    @Inject(TRANSACTION_REPOSITORY) private readonly transactions: TransactionRepository,
    @Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepository,
    private readonly events: EventBus,
  ) {}

  async execute(id: string, command: UpdateTransactionCommand): Promise<TransactionView> {
    const existing = await this.transactions.findById(id);
    if (!existing) throw new EntityNotFoundError('Transacción', id);

    const date = command.date ? new Date(command.date) : existing.date;
    const input = toFactoryInput(id, date, command);
    await assertAccountsExist(this.accounts, input);

    const updated = TransactionFactory.create(input);
    await this.transactions.save(updated);
    await this.events.publish(new LedgerChangedEvent('transaction'));
    return toTransactionView(updated);
  }
}
