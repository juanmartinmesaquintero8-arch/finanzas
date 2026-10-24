import { Module } from '@nestjs/common';
import { CreateTransactionUseCase } from './application/transactions/create-transaction.use-case';
import { DeleteTransactionUseCase } from './application/transactions/delete-transaction.use-case';
import { ListTransactionsUseCase } from './application/transactions/list-transactions.use-case';
import { TransactionsController } from './infrastructure/http/transactions.controller';

@Module({
  controllers: [TransactionsController],
  providers: [CreateTransactionUseCase, DeleteTransactionUseCase, ListTransactionsUseCase],
})
export class TransactionsModule {}
