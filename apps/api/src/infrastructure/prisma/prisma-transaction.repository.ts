import {
  Transaction,
  TransactionPageQuery,
  TransactionQuery,
  TransactionRepository,
} from '@finanzas/domain';
import { Prisma } from '@prisma/client';
import { toTransaction, toTransactionData } from './mappers';
import { PrismaExecutor } from './prisma.service';

const involvesAccount = (accountId: string): Prisma.TransactionWhereInput => ({
  OR: [{ accountId }, { fromAccountId: accountId }, { toAccountId: accountId }],
});

export class PrismaTransactionRepository implements TransactionRepository {
  constructor(private readonly client: PrismaExecutor) {}

  async findAll(query: TransactionQuery = {}): Promise<Transaction[]> {
    const where: Prisma.TransactionWhereInput = {
      AND: [
        query.accountId ? involvesAccount(query.accountId) : {},
        { date: { gte: query.from, lte: query.to } },
      ],
    };
    const rows = await this.client.transaction.findMany({ where, orderBy: [{ date: 'desc' }, { id: 'asc' }] });
    return rows.map(toTransaction);
  }

  async findById(id: string): Promise<Transaction | null> {
    const row = await this.client.transaction.findUnique({ where: { id } });
    return row ? toTransaction(row) : null;
  }

  /** Keyset sobre (date DESC, id ASC): usa el índice `transactions(date DESC, id)`; sin OFFSET. */
  async findPage({ accountId, limit, after }: TransactionPageQuery): Promise<Transaction[]> {
    const where: Prisma.TransactionWhereInput = {
      AND: [
        accountId ? involvesAccount(accountId) : {},
        after
          ? { OR: [{ date: { lt: after.date } }, { date: after.date, id: { gt: after.id } }] }
          : {},
      ],
    };
    const rows = await this.client.transaction.findMany({
      where,
      orderBy: [{ date: 'desc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map(toTransaction);
  }

  /**
   * Variación neta por cuenta con una sola agregación SQL:
   * INCOME +, EXPENSE − sobre account_id; TRANSFER − en from_account_id y + en to_account_id.
   */
  async balanceDeltas(): Promise<Map<string, bigint>> {
    const rows = await this.client.$queryRaw<{ account_id: string; total: string }[]>`
      SELECT account_id::text AS account_id, SUM(delta)::text AS total
      FROM (
        SELECT account_id, CASE WHEN type = 'INCOME' THEN amount ELSE -amount END AS delta
          FROM transactions WHERE account_id IS NOT NULL
        UNION ALL
        SELECT from_account_id, -amount FROM transactions WHERE from_account_id IS NOT NULL
        UNION ALL
        SELECT to_account_id, amount FROM transactions WHERE to_account_id IS NOT NULL
      ) AS movements
      GROUP BY account_id`;
    return new Map(rows.map((r) => [r.account_id, BigInt(r.total)]));
  }

  async save(transaction: Transaction): Promise<void> {
    await this.client.transaction.create({ data: toTransactionData(transaction) });
  }

  async saveMany(transactions: readonly Transaction[]): Promise<void> {
    if (transactions.length === 0) return;
    await this.client.transaction.createMany({ data: transactions.map(toTransactionData) });
  }

  async delete(id: string): Promise<void> {
    await this.client.transaction.deleteMany({ where: { id } });
  }
}
