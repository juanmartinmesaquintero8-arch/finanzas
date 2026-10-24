import { ScheduledExpense, ScheduledExpenseRepository } from '@finanzas/domain';
import { toScheduledData, toScheduledExpense } from './mappers';
import { PrismaExecutor } from './prisma.service';

export class PrismaScheduledExpenseRepository implements ScheduledExpenseRepository {
  constructor(private readonly client: PrismaExecutor) {}

  async findAll(): Promise<ScheduledExpense[]> {
    const rows = await this.client.scheduledExpense.findMany({ orderBy: [{ startDate: 'asc' }, { id: 'asc' }] });
    return rows.map(toScheduledExpense);
  }

  async findById(id: string): Promise<ScheduledExpense | null> {
    const row = await this.client.scheduledExpense.findUnique({ where: { id } });
    return row ? toScheduledExpense(row) : null;
  }

  async save(expense: ScheduledExpense): Promise<void> {
    const data = toScheduledData(expense);
    await this.client.scheduledExpense.upsert({ where: { id: expense.id }, create: data, update: data });
  }

  async delete(id: string): Promise<void> {
    await this.client.scheduledExpense.deleteMany({ where: { id } });
  }
}
