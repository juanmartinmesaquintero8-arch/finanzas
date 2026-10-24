import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ACCOUNT_REPOSITORY, Account, AccountRepository, AccountType } from '@finanzas/domain';
import { DEFAULT_CURRENCY } from '../config';
import { EventBus } from '../events/event-bus';
import { LedgerChangedEvent } from '../events/ledger-changed.event';
import { parseMoney } from '../money-parser';
import { AccountView, toAccountView } from '../views';

export interface CreateAccountInput {
  name: string;
  type: AccountType;
  /** Entero en unidades mínimas, como string. Por defecto "0". */
  initialBalance?: string;
  currency?: string;
}

@Injectable()
export class CreateAccountUseCase {
  constructor(
    @Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepository,
    private readonly events: EventBus,
  ) {}

  async execute(input: CreateAccountInput): Promise<AccountView> {
    const account = Account.create({
      id: randomUUID(),
      name: input.name,
      type: input.type,
      initialBalance: parseMoney(input.initialBalance ?? '0', input.currency ?? DEFAULT_CURRENCY),
    });
    await this.accounts.save(account);
    await this.events.publish(new LedgerChangedEvent('account'));
    return toAccountView(account);
  }
}
