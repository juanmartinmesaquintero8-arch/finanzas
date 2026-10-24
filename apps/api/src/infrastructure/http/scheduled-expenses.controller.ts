import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CreateScheduledExpenseUseCase } from '../../application/scheduled-expenses/create-scheduled-expense.use-case';
import { DeleteScheduledExpenseUseCase } from '../../application/scheduled-expenses/delete-scheduled-expense.use-case';
import { ListScheduledExpensesUseCase } from '../../application/scheduled-expenses/list-scheduled-expenses.use-case';
import { SettleScheduledExpenseUseCase } from '../../application/scheduled-expenses/settle-scheduled-expense.use-case';
import { CreateScheduledExpenseDto, SettleScheduledExpenseDto } from './dto';

@Controller('scheduled-expenses')
export class ScheduledExpensesController {
  constructor(
    private readonly createExpense: CreateScheduledExpenseUseCase,
    private readonly listExpenses: ListScheduledExpensesUseCase,
    private readonly deleteExpense: DeleteScheduledExpenseUseCase,
    private readonly settleExpense: SettleScheduledExpenseUseCase,
  ) {}

  @Post()
  create(@Body() dto: CreateScheduledExpenseDto) {
    return this.createExpense.execute(dto);
  }

  @Get()
  list() {
    return this.listExpenses.execute();
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.deleteExpense.execute(id);
  }

  @Post(':id/settle')
  @HttpCode(200)
  settle(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SettleScheduledExpenseDto) {
    return this.settleExpense.execute({ id, ...dto });
  }
}
