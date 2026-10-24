import { Account, AccountRepository } from '@finanzas/domain';
import { toAccount } from './mappers';
import { PrismaExecutor } from './prisma.service';

export class PrismaAccountRepository implements AccountRepository {
  constructor(private readonly client: PrismaExecutor) {}

  async findAll(): Promise<Account[]> {
    const rows = await this.client.account.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    return rows.map(toAccount);
  }

  async findById(id: string): Promise<Account | null> {
    const row = await this.client.account.findUnique({ where: { id } });
    return row ? toAccount(row) : null;
  }

  async save(account: Account): Promise<void> {
    const data = {
      name: account.name,
      type: account.type,
      currency: account.currency,
      initialBalance: account.initialBalance.amount,
    };
    await this.client.account.upsert({ where: { id: account.id }, create: { id: account.id, ...data }, update: data });
  }
}
