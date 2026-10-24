import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { GetProjectionUseCase } from '../../application/summary/get-projection.use-case';
import { GetSummaryUseCase } from '../../application/summary/get-summary.use-case';
import { ProjectionQueryDto } from './dto';
import { withEtag } from './etag';

@Controller()
export class SummaryController {
  constructor(
    private readonly getSummary: GetSummaryUseCase,
    private readonly getProjection: GetProjectionUseCase,
  ) {}

  @Get('summary')
  async summary(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return withEtag(req, res, await this.getSummary.execute());
  }

  @Get('projection')
  async projection(@Query() query: ProjectionQueryDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return withEtag(req, res, await this.getProjection.execute({ to: query.to }));
  }
}
