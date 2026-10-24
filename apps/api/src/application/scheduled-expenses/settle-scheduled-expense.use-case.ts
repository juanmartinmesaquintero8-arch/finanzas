import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { TransactionFactory, assertDomain } from '@finanzas/domain';
import { parseDay } from '../dates';
import { EntityNotFoundError } from '../errors';
import { EventBus } from '../events/event-bus';
import { LedgerChangedEvent } from '../events/ledger-changed.event';
import { UNIT_OF_WORK, UnitOfWork } from '../ports/unit-of-work.port';
import { ScheduledExpenseView, toScheduledExpenseView } from '../views';

export interface SettleScheduledExpenseCommand {
  id: string;
  /** Se liquidan todas las ocurrencias hasta esta fecha (inclusive). */
  through: string;
  /** Si es true, registra además un gasto real por cada ocurrencia liquidada. */
  createTransactions?: boolean;
}

@Injectable()
export class SettleScheduledExpenseUseCase {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    private readonly events: EventBus,
  ) {}

  async execute(command: SettleScheduledExpenseCommand): Promise<ScheduledExpenseView> {
    const through = parseDay(command.through);

    // Una sola transacción de BD: gastos reales + marca de liquidado, todo o nada.
    const { settled, createdTransactions } = await this.unitOfWork.run(async ({ scheduledExpenses, transactions }) => {
      const expense = await scheduledExpenses.findById(command.id);
      if (!expense) throw new EntityNotFoundError('Gasto programado', command.id);
      assertDomain(
        !expense.settledThrough || through.getTime() > expense.settledThrough.getTime(),
        'El gasto ya está liquidado hasta esa fecha o una posterior',
      );

      const occurrences = command.createTransactions ? expense.pendingOccurrences(expense.startDate, through) : [];
      const real = occurrences.map((date) =>
        TransactionFactory.create({
          id: randomUUID(),
          type: 'EXPENSE',
          accountId: expense.accountId,
          amount: expense.amount,
          date,
          description: expense.description,
        }),
      );
      if (real.length > 0) await transactions.saveMany(real);

      const next = expense.markSettled(through);
      await scheduledExpenses.save(next);
      return { settled: next, createdTransactions: real.length > 0 };
    });

    if (createdTransactions) await this.events.publish(new LedgerChangedEvent('transaction'));
    await this.events.publish(new LedgerChangedEvent('scheduled-expense'));
    return toScheduledExpenseView(settled);
  }
}
