import { Inject, Injectable } from '@nestjs/common';
import { TRANSACTION_REPOSITORY, TransactionRepository } from '@finanzas/domain';
import { EntityNotFoundError } from '../errors';
import { TransactionView, toTransactionView } from '../views';

@Injectable()
export class GetTransactionUseCase {
  constructor(@Inject(TRANSACTION_REPOSITORY) private readonly transactions: TransactionRepository) {}

  async execute(id: string): Promise<TransactionView> {
    const transaction = await this.transactions.findById(id);
    if (!transaction) throw new EntityNotFoundError('Transacción', id);
    return toTransactionView(transaction);
  }
}
