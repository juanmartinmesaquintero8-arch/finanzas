import { Module } from '@nestjs/common';
import { CreateAccountUseCase } from './application/accounts/create-account.use-case';
import { GetAccountUseCase } from './application/accounts/get-account.use-case';
import { ListAccountsUseCase } from './application/accounts/list-accounts.use-case';
import { UpdateAccountUseCase } from './application/accounts/update-account.use-case';
import { AccountsController } from './infrastructure/http/accounts.controller';

@Module({
  controllers: [AccountsController],
  providers: [CreateAccountUseCase, ListAccountsUseCase, GetAccountUseCase, UpdateAccountUseCase],
})
export class AccountsModule {}
