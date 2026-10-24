import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { CreateScheduledExpenseUseCase } from '../../application/scheduled-expenses/create-scheduled-expense.use-case';
import { DeleteScheduledExpenseUseCase } from '../../application/scheduled-expenses/delete-scheduled-expense.use-case';
import { ListScheduledExpensesUseCase } from '../../application/scheduled-expenses/list-scheduled-expenses.use-case';
import { SettleScheduledExpenseUseCase } from '../../application/scheduled-expenses/settle-scheduled-expense.use-case';
import { UpdateScheduledExpenseUseCase } from '../../application/scheduled-expenses/update-scheduled-expense.use-case';
import { CreateScheduledExpenseDto, SettleScheduledExpenseDto, UpdateScheduledExpenseDto } from './dto';

@Controller('scheduled-expenses')
export class ScheduledExpensesController {
  constructor(
    private readonly createExpense: CreateScheduledExpenseUseCase,
    private readonly listExpenses: ListScheduledExpensesUseCase,
    private readonly deleteExpense: DeleteScheduledExpenseUseCase,
    private readonly settleExpense: SettleScheduledExpenseUseCase,
    private readonly updateExpense: UpdateScheduledExpenseUseCase,
  ) {}

  @Post()
  create(@Body() dto: CreateScheduledExpenseDto) {
    return this.createExpense.execute(dto);
  }

  @Get()
  list() {
    return this.listExpenses.execute();
  }

  @Put(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateScheduledExpenseDto) {
    return this.updateExpense.execute(id, dto);
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
