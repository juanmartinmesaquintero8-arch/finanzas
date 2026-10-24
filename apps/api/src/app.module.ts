import { Module } from '@nestjs/common';
import { AccountsModule } from './accounts.module';
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { ScheduledExpensesModule } from './scheduled-expenses.module';
import { SummaryModule } from './summary.module';
import { TransactionsModule } from './transactions.module';

@Module({
  imports: [InfrastructureModule, AccountsModule, TransactionsModule, ScheduledExpensesModule, SummaryModule],
})
export class AppModule {}
