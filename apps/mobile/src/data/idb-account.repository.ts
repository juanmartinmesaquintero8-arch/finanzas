import type { Account, AccountRepository } from '@finanzas/domain';
import type { FinanzasDb } from './database';
import { toAccount, toStoredAccount } from './mappers';

/** Adaptador IndexedDB del puerto AccountRepository. */
export class IdbAccountRepository implements AccountRepository {
  constructor(private readonly db: FinanzasDb) {}

  async findAll(): Promise<Account[]> {
    return (await this.db.getAll('accounts')).map(toAccount);
  }

  async findById(id: string): Promise<Account | null> {
    const row = await this.db.get('accounts', id);
    return row ? toAccount(row) : null;
  }

  async save(account: Account): Promise<void> {
    await this.db.put('accounts', toStoredAccount(account));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete('accounts', id);
  }
}
