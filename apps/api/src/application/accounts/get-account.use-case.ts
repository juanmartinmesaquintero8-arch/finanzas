import { Inject, Injectable } from '@nestjs/common';
import { ACCOUNT_REPOSITORY, AccountRepository } from '@finanzas/domain';
import { EntityNotFoundError } from '../errors';
import { AccountView, toAccountView } from '../views';

@Injectable()
export class GetAccountUseCase {
  constructor(@Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepository) {}

  async execute(id: string): Promise<AccountView> {
    const account = await this.accounts.findById(id);
    if (!account) throw new EntityNotFoundError('Cuenta', id);
    return toAccountView(account);
  }
}
