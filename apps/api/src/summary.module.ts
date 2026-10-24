import { Module } from '@nestjs/common';
import { GetProjectionUseCase } from './application/summary/get-projection.use-case';
import { GetSummaryUseCase } from './application/summary/get-summary.use-case';
import { SummaryController } from './infrastructure/http/summary.controller';

@Module({
  controllers: [SummaryController],
  providers: [GetSummaryUseCase, GetProjectionUseCase],
})
export class SummaryModule {}
