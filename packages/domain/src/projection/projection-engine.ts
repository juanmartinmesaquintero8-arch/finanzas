import { BalanceSnapshot } from '../ledger/balance-calculator';
import { Money } from '../money/money';
import { ScheduledExpense } from '../scheduled/scheduled-expense';
import { startOfDayUTC } from '../shared/date';

export interface Commitment {
  scheduledExpenseId: string;
  description: string;
  accountId: string;
  date: Date;
  amount: Money;
}

export interface AccountProjection {
  accountId: string;
  balance: Money;
  committed: Money;
  available: Money;
}

export interface TimelinePoint {
  date: Date;
  balance: Money;
}

export interface Projection {
  from: Date;
  to: Date;
  netWorth: Money;
  committed: Money;
  /** Saldo Real Disponible = patrimonio − compromisos pendientes hasta `to`. */
  availableBalance: Money;
  isShortfall: boolean;
  commitments: Commitment[];
  accounts: AccountProjection[];
  timeline: TimelinePoint[];
}

export interface ProjectionInput {
  snapshot: BalanceSnapshot;
  scheduledExpenses: readonly ScheduledExpense[];
  from: Date;
  to: Date;
}

/** Motor de proyecciones: resta los gastos programados futuros al patrimonio actual. */
export class ProjectionEngine {
  constructor(private readonly currency: string) {}

  project({ snapshot, scheduledExpenses, from, to }: ProjectionInput): Projection {
    const commitments = this.expandCommitments(scheduledExpenses, from, to);
    const committed = Money.sum(commitments.map((c) => c.amount), this.currency);
    const availableBalance = snapshot.netWorth.subtract(committed);

    return {
      from: startOfDayUTC(from),
      to: startOfDayUTC(to),
      netWorth: snapshot.netWorth,
      committed,
      availableBalance,
      isShortfall: availableBalance.isNegative(),
      commitments,
      accounts: this.projectAccounts(snapshot, commitments),
      timeline: this.buildTimeline(snapshot.netWorth, commitments, startOfDayUTC(from)),
    };
  }

  private expandCommitments(scheduled: readonly ScheduledExpense[], from: Date, to: Date): Commitment[] {
    return scheduled
      .flatMap((se) =>
        se.pendingOccurrences(from, to).map((date) => ({
          scheduledExpenseId: se.id,
          description: se.description,
          accountId: se.accountId,
          date,
          amount: se.amount,
        })),
      )
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  private projectAccounts(snapshot: BalanceSnapshot, commitments: Commitment[]): AccountProjection[] {
    return snapshot.balances.map(({ accountId, balance }) => {
      const committed = Money.sum(
        commitments.filter((c) => c.accountId === accountId).map((c) => c.amount),
        this.currency,
      );
      return { accountId, balance, committed, available: balance.subtract(committed) };
    });
  }

  private buildTimeline(start: Money, commitments: Commitment[], from: Date): TimelinePoint[] {
    const timeline: TimelinePoint[] = [{ date: from, balance: start }];
    for (const c of commitments) {
      const last = timeline[timeline.length - 1];
      const balance = last.balance.subtract(c.amount);
      if (last.date.getTime() === c.date.getTime()) {
        timeline[timeline.length - 1] = { date: c.date, balance };
      } else {
        timeline.push({ date: c.date, balance });
      }
    }
    return timeline;
  }
}
