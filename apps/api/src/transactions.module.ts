import { Module } from '@nestjs/common';
import { CreateTransactionUseCase } from './application/transactions/create-transaction.use-case';
import { DeleteTransactionUseCase } from './application/transactions/delete-transaction.use-case';
import { GetTransactionUseCase } from './application/transactions/get-transaction.use-case';
import { ListTransactionsUseCase } from './application/transactions/list-transactions.use-case';
import { UpdateTransactionUseCase } from './application/transactions/update-transaction.use-case';
import { TransactionsController } from './infrastructure/http/transactions.controller';

@Module({
  controllers: [TransactionsController],
  providers: [CreateTransactionUseCase, DeleteTransactionUseCase, ListTransactionsUseCase, GetTransactionUseCase, UpdateTransactionUseCase],
})
export class TransactionsModule {}
