import { Inject, Injectable } from '@nestjs/common';
import { TRANSACTION_REPOSITORY, TransactionRepository } from '@finanzas/domain';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../config';
import { TransactionView, toTransactionView } from '../views';
import { decodeCursor, encodeCursor } from './cursor';

export interface ListTransactionsQuery {
  accountId?: string;
  limit?: number;
  cursor?: string;
}

export interface TransactionPage {
  items: TransactionView[];
  nextCursor: string | null;
}

@Injectable()
export class ListTransactionsUseCase {
  constructor(@Inject(TRANSACTION_REPOSITORY) private readonly transactions: TransactionRepository) {}

  async execute(query: ListTransactionsQuery = {}): Promise<TransactionPage> {
    const limit = Math.min(Math.max(Math.trunc(query.limit ?? DEFAULT_PAGE_SIZE), 1), MAX_PAGE_SIZE);
    const after = query.cursor ? decodeCursor(query.cursor) : undefined;

    // Se pide una fila extra para saber si existe una página siguiente sin contar.
    const rows = await this.transactions.findPage({ accountId: query.accountId, limit: limit + 1, after });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];

    return {
      items: page.map(toTransactionView),
      nextCursor: hasMore && last ? encodeCursor({ date: last.date, id: last.id }) : null,
    };
  }
}
