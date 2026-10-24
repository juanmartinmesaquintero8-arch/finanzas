import { Inject, Injectable } from '@nestjs/common';
import { ACCOUNT_REPOSITORY, Account, AccountRepository, AccountType } from '@finanzas/domain';
import { EntityNotFoundError } from '../errors';
import { EventBus } from '../events/event-bus';
import { LedgerChangedEvent } from '../events/ledger-changed.event';
import { parseMoney } from '../money-parser';
import { AccountView, toAccountView } from '../views';

export interface UpdateAccountCommand {
  name?: string;
  type?: AccountType;
  /** Entero en unidades mínimas, como string. */
  initialBalance?: string;
}

@Injectable()
export class UpdateAccountUseCase {
  constructor(
    @Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepository,
    private readonly events: EventBus,
  ) {}

  async execute(id: string, command: UpdateAccountCommand): Promise<AccountView> {
    const existing = await this.accounts.findById(id);
    if (!existing) throw new EntityNotFoundError('Cuenta', id);

    const updated = Account.create({
      id,
      name: command.name ?? existing.name,
      type: command.type ?? existing.type,
      initialBalance:
        command.initialBalance === undefined
          ? existing.initialBalance
          : parseMoney(command.initialBalance, existing.currency),
    });
    await this.accounts.save(updated);
    await this.events.publish(new LedgerChangedEvent('account'));
    return toAccountView(updated);
  }
}
