import type { ScheduledIncome, ScheduledIncomeRepository } from '@finanzas/domain';
import type { FinanzasDb } from './database';
import { toIncome, toStoredIncome } from './mappers';

/** Adaptador IndexedDB del puerto ScheduledIncomeRepository. */
export class IdbScheduledIncomeRepository implements ScheduledIncomeRepository {
  constructor(private readonly db: FinanzasDb) {}

  async findAll(): Promise<ScheduledIncome[]> {
    return (await this.db.getAll('scheduledIncomes')).map(toIncome);
  }

  async findById(id: string): Promise<ScheduledIncome | null> {
    const row = await this.db.get('scheduledIncomes', id);
    return row ? toIncome(row) : null;
  }

  async save(income: ScheduledIncome): Promise<void> {
    await this.db.put('scheduledIncomes', toStoredIncome(income));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete('scheduledIncomes', id);
  }
}
