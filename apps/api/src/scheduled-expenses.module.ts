import { Module } from '@nestjs/common';
import { CreateScheduledExpenseUseCase } from './application/scheduled-expenses/create-scheduled-expense.use-case';
import { DeleteScheduledExpenseUseCase } from './application/scheduled-expenses/delete-scheduled-expense.use-case';
import { ListScheduledExpensesUseCase } from './application/scheduled-expenses/list-scheduled-expenses.use-case';
import { SettleScheduledExpenseUseCase } from './application/scheduled-expenses/settle-scheduled-expense.use-case';
import { ScheduledExpensesController } from './infrastructure/http/scheduled-expenses.controller';

@Module({
  controllers: [ScheduledExpensesController],
  providers: [
    CreateScheduledExpenseUseCase,
    ListScheduledExpensesUseCase,
    DeleteScheduledExpenseUseCase,
    SettleScheduledExpenseUseCase,
  ],
})
export class ScheduledExpensesModule {}
