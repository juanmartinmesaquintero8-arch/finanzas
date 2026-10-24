import { Money } from '../money/money';
import { ExpenseTransaction, IncomeTransaction, Transaction, TransferTransaction } from './transaction';

interface CommonInput {
  id: string;
  amount: Money;
  date: Date;
  description: string;
  category?: string;
}

export type CreateTransactionInput =
  | (CommonInput & { type: 'INCOME'; accountId: string })
  | (CommonInput & { type: 'EXPENSE'; accountId: string })
  | (CommonInput & { type: 'TRANSFER'; fromAccountId: string; toAccountId: string });

/** Factory: única puerta de entrada para construir transacciones según su tipo. */
export const TransactionFactory = {
  create(input: CreateTransactionInput): Transaction {
    switch (input.type) {
      case 'INCOME':
        return new IncomeTransaction(input);
      case 'EXPENSE':
        return new ExpenseTransaction(input);
      case 'TRANSFER':
        return new TransferTransaction(input);
    }
  },
};
