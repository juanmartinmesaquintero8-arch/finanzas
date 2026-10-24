import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  ACCOUNT_REPOSITORY,
  AccountRepository,
  TRANSACTION_REPOSITORY,
  TransactionFactory,
  TransactionRepository,
} from '@finanzas/domain';
import { EventBus } from '../events/event-bus';
import { LedgerChangedEvent } from '../events/ledger-changed.event';
import { CLOCK, Clock } from '../ports/clock.port';
import { TransactionView, toTransactionView } from '../views';
import { TransactionCommand, assertAccountsExist, toFactoryInput } from './transaction-input';

export type CreateTransactionCommand = TransactionCommand;

@Injectable()
export class CreateTransactionUseCase {
  constructor(
    @Inject(TRANSACTION_REPOSITORY) private readonly transactions: TransactionRepository,
    @Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepository,
    private readonly events: EventBus,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: CreateTransactionCommand): Promise<TransactionView> {
    const date = command.date ? new Date(command.date) : this.clock.now();
    const input = toFactoryInput(randomUUID(), date, command);
    await assertAccountsExist(this.accounts, input);

    const transaction = TransactionFactory.create(input);
    await this.transactions.save(transaction);
    await this.events.publish(new LedgerChangedEvent('transaction'));
    return toTransactionView(transaction);
  }
}
