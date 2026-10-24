import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CreateAccountUseCase } from '../../application/accounts/create-account.use-case';
import { GetAccountUseCase } from '../../application/accounts/get-account.use-case';
import { ListAccountsUseCase } from '../../application/accounts/list-accounts.use-case';
import { CreateAccountDto } from './dto';

@Controller('accounts')
export class AccountsController {
  constructor(
    private readonly createAccount: CreateAccountUseCase,
    private readonly listAccounts: ListAccountsUseCase,
    private readonly getAccount: GetAccountUseCase,
  ) {}

  @Post()
  create(@Body() dto: CreateAccountDto) {
    return this.createAccount.execute(dto);
  }

  @Get()
  list() {
    return this.listAccounts.execute();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.getAccount.execute(id);
  }
}
