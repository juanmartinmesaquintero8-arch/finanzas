import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CreateTransactionUseCase } from '../../application/transactions/create-transaction.use-case';
import { DeleteTransactionUseCase } from '../../application/transactions/delete-transaction.use-case';
import { ListTransactionsUseCase } from '../../application/transactions/list-transactions.use-case';
import { CreateTransactionDto, ListTransactionsQueryDto } from './dto';

@Controller('transactions')
export class TransactionsController {
  constructor(
    private readonly createTransaction: CreateTransactionUseCase,
    private readonly deleteTransaction: DeleteTransactionUseCase,
    private readonly listTransactions: ListTransactionsUseCase,
  ) {}

  @Post()
  create(@Body() dto: CreateTransactionDto) {
    return this.createTransaction.execute(dto);
  }

  @Get()
  list(@Query() query: ListTransactionsQueryDto) {
    return this.listTransactions.execute(query);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.deleteTransaction.execute(id);
  }
}
