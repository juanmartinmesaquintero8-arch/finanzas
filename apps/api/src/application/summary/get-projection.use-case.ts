import { Inject, Injectable } from '@nestjs/common';
import {
  ACCOUNT_REPOSITORY,
  AccountRepository,
  BalanceCalculator,
  ProjectionEngine,
  SCHEDULED_EXPENSE_REPOSITORY,
  ScheduledExpenseRepository,
  TRANSACTION_REPOSITORY,
  TransactionRepository,
  daysInMonthUTC,
  startOfDayUTC,
} from '@finanzas/domain';
import { CACHE_KEYS } from '../cache-keys';
import { DEFAULT_CURRENCY, MAX_PROJECTION_MONTHS } from '../config';
import { parseDay } from '../dates';
import { InvalidRequestError } from '../errors';
import { CACHE_PORT, CachePort } from '../ports/cache.port';
import { CLOCK, Clock } from '../ports/clock.port';
import { readThrough } from '../read-through';
import { MoneyView, isoDay } from '../views';

export interface ProjectionView {
  from: string;
  to: string;
  netWorth: MoneyView;
  committed: MoneyView;
  /** Saldo Real Disponible. */
  availableBalance: MoneyView;
  isShortfall: boolean;
  commitments: { scheduledExpenseId: string; description: string; accountId: string; date: string; amount: MoneyView }[];
  accounts: { accountId: string; name: string; balance: MoneyView; committed: MoneyView; available: MoneyView }[];
  timeline: { date: string; balance: MoneyView }[];
}

function addMonthsUTC(date: Date, months: number): Date {
  const total = date.getUTCMonth() + months;
  const year = date.getUTCFullYear() + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), daysInMonthUTC(year, month))));
}

@Injectable()
export class GetProjectionUseCase {
  private readonly calculator = new BalanceCalculator(DEFAULT_CURRENCY);
  private readonly engine = new ProjectionEngine(DEFAULT_CURRENCY);

  constructor(
    @Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepository,
    @Inject(TRANSACTION_REPOSITORY) private readonly transactions: TransactionRepository,
    @Inject(SCHEDULED_EXPENSE_REPOSITORY) private readonly scheduled: ScheduledExpenseRepository,
    @Inject(CACHE_PORT) private readonly cache: CachePort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute({ to }: { to: string }): Promise<ProjectionView> {
    const from = startOfDayUTC(this.clock.now());
    const toDate = parseDay(to);
    if (toDate.getTime() < from.getTime()) {
      throw new InvalidRequestError('La fecha de corte no puede ser anterior a hoy');
    }
    if (toDate.getTime() > addMonthsUTC(from, MAX_PROJECTION_MONTHS).getTime()) {
      throw new InvalidRequestError(`El horizonte máximo de proyección es de ${MAX_PROJECTION_MONTHS} meses`);
    }
    return readThrough(this.cache, CACHE_KEYS.projection(isoDay(from), isoDay(toDate)), () => this.compute(from, toDate));
  }

  private async compute(from: Date, to: Date): Promise<ProjectionView> {
    const [accounts, deltas, scheduledExpenses] = await Promise.all([
      this.accounts.findAll(),
      this.transactions.balanceDeltas(),
      this.scheduled.findAll(),
    ]);
    const snapshot = this.calculator.fromTotals(accounts, deltas);
    const projection = this.engine.project({ snapshot, scheduledExpenses, from, to });
    const names = new Map(accounts.map((a) => [a.id, a.name]));

    return {
      from: isoDay(projection.from),
      to: isoDay(projection.to),
      netWorth: projection.netWorth.toJSON(),
      committed: projection.committed.toJSON(),
      availableBalance: projection.availableBalance.toJSON(),
      isShortfall: projection.isShortfall,
      commitments: projection.commitments.map((c) => ({
        scheduledExpenseId: c.scheduledExpenseId,
        description: c.description,
        accountId: c.accountId,
        date: isoDay(c.date),
        amount: c.amount.toJSON(),
      })),
      accounts: projection.accounts.map((a) => ({
        accountId: a.accountId,
        name: names.get(a.accountId) ?? '',
        balance: a.balance.toJSON(),
        committed: a.committed.toJSON(),
        available: a.available.toJSON(),
      })),
      timeline: projection.timeline.map((p) => ({ date: isoDay(p.date), balance: p.balance.toJSON() })),
    };
  }
}
