import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  ACCOUNT_REPOSITORY,
  AccountRepository,
  CreateTransactionInput as FactoryInput,
  DomainValidationError,
  TRANSACTION_REPOSITORY,
  TransactionFactory,
  TransactionRepository,
  TransactionType,
  UnknownAccountError,
  assertDomain,
} from '@finanzas/domain';
import { DEFAULT_CURRENCY } from '../config';
import { EventBus } from '../events/event-bus';
import { LedgerChangedEvent } from '../events/ledger-changed.event';
import { parseMoney } from '../money-parser';
import { CLOCK, Clock } from '../ports/clock.port';
import { TransactionView, toTransactionView } from '../views';

export interface CreateTransactionCommand {
  type: TransactionType;
  amount: string;
  currency?: string;
  /** ISO 8601; por defecto, el instante actual. */
  date?: string;
  description: string;
  category?: string;
  accountId?: string;
  fromAccountId?: string;
  toAccountId?: string;
}

@Injectable()
export class CreateTransactionUseCase {
  constructor(
    @Inject(TRANSACTION_REPOSITORY) private readonly transactions: TransactionRepository,
    @Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepository,
    private readonly events: EventBus,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: CreateTransactionCommand): Promise<TransactionView> {
    const common = {
      id: randomUUID(),
      amount: parseMoney(command.amount, command.currency ?? DEFAULT_CURRENCY),
      date: command.date ? new Date(command.date) : this.clock.now(),
      description: command.description,
      category: command.category,
    };
    const input = this.toFactoryInput(command, common);
    await this.assertAccountsExist(input.type === 'TRANSFER' ? [input.fromAccountId, input.toAccountId] : [input.accountId]);

    const transaction = TransactionFactory.create(input);
    await this.transactions.save(transaction);
    await this.events.publish(new LedgerChangedEvent('transaction'));
    return toTransactionView(transaction);
  }

  private toFactoryInput(
    command: CreateTransactionCommand,
    common: Omit<FactoryInput, 'type' | 'accountId' | 'fromAccountId' | 'toAccountId'>,
  ): FactoryInput {
    if (command.type === 'TRANSFER') {
      assertDomain(!!command.fromAccountId && !!command.toAccountId, 'La transferencia requiere cuenta origen y destino');
      return { ...common, type: 'TRANSFER', fromAccountId: command.fromAccountId, toAccountId: command.toAccountId };
    }
    if (command.type === 'INCOME' || command.type === 'EXPENSE') {
      assertDomain(!!command.accountId, 'El ingreso o gasto requiere una cuenta');
      return { ...common, type: command.type, accountId: command.accountId };
    }
    throw new DomainValidationError(`Tipo de transacción inválido: ${String(command.type)}`);
  }

  private async assertAccountsExist(ids: string[]): Promise<void> {
    const found = await Promise.all(ids.map((id) => this.accounts.findById(id)));
    const missing = ids.find((_, i) => !found[i]);
    if (missing) throw new UnknownAccountError(missing);
  }
}
