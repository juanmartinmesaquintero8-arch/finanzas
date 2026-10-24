import { Inject, Injectable } from '@nestjs/common';
import { ACCOUNT_REPOSITORY, AccountRepository } from '@finanzas/domain';
import { AccountView, toAccountView } from '../views';

@Injectable()
export class ListAccountsUseCase {
  constructor(@Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepository) {}

  async execute(): Promise<AccountView[]> {
    return (await this.accounts.findAll()).map(toAccountView);
  }
}
