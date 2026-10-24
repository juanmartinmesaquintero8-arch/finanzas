import type { ScheduledExpense, ScheduledExpenseRepository } from '@finanzas/domain';
import type { FinanzasDb } from './database';
import { toScheduled, toStoredScheduled } from './mappers';

/** Adaptador IndexedDB del puerto ScheduledExpenseRepository. */
export class IdbScheduledExpenseRepository implements ScheduledExpenseRepository {
  constructor(private readonly db: FinanzasDb) {}

  async findAll(): Promise<ScheduledExpense[]> {
    return (await this.db.getAll('scheduledExpenses')).map(toScheduled);
  }

  async findById(id: string): Promise<ScheduledExpense | null> {
    const row = await this.db.get('scheduledExpenses', id);
    return row ? toScheduled(row) : null;
  }

  async save(expense: ScheduledExpense): Promise<void> {
    await this.db.put('scheduledExpenses', toStoredScheduled(expense));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete('scheduledExpenses', id);
  }
}
