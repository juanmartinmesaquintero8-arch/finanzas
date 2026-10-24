import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { CreateTransactionUseCase } from '../../application/transactions/create-transaction.use-case';
import { DeleteTransactionUseCase } from '../../application/transactions/delete-transaction.use-case';
import { GetTransactionUseCase } from '../../application/transactions/get-transaction.use-case';
import { ListTransactionsUseCase } from '../../application/transactions/list-transactions.use-case';
import { UpdateTransactionUseCase } from '../../application/transactions/update-transaction.use-case';
import { CreateTransactionDto, ListTransactionsQueryDto, UpdateTransactionDto } from './dto';

@Controller('transactions')
export class TransactionsController {
  constructor(
    private readonly createTransaction: CreateTransactionUseCase,
    private readonly deleteTransaction: DeleteTransactionUseCase,
    private readonly listTransactions: ListTransactionsUseCase,
    private readonly getTransaction: GetTransactionUseCase,
    private readonly updateTransaction: UpdateTransactionUseCase,
  ) {}

  @Post()
  create(@Body() dto: CreateTransactionDto) {
    return this.createTransaction.execute(dto);
  }

  @Get()
  list(@Query() query: ListTransactionsQueryDto) {
    return this.listTransactions.execute(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.getTransaction.execute(id);
  }

  @Put(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTransactionDto) {
    return this.updateTransaction.execute(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.deleteTransaction.execute(id);
  }
}
