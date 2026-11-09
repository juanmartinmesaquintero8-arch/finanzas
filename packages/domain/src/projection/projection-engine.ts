import { BalanceSnapshot } from '../ledger/balance-calculator';
import { Money } from '../money/money';
import { ScheduledExpense } from '../scheduled/scheduled-expense';
import { ScheduledIncome } from '../scheduled/scheduled-income';
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
  /** Ingresos programados que se esperan hasta `to` (los vencidos sin recibir no cuentan). No son dinero todavía. */
  expectedIncome: Money;
  /** Disponible + ingresos esperados. Solo informativo: el Saldo Real Disponible no lo usa. */
  availableWithIncome: Money;
  /** Punto más bajo del saldo día a día, con compromisos e ingresos (el ingreso del día va primero; en empate, el primero). */
  lowestWithIncome: TimelinePoint;
  /** Fecha del último ingreso esperado dentro de la ventana; sin valor si no hay ninguno. */
  lastExpectedIncomeDate?: Date;
}

export interface ProjectionInput {
  snapshot: BalanceSnapshot;
  scheduledExpenses: readonly ScheduledExpense[];
  scheduledIncomes?: readonly ScheduledIncome[];
  from: Date;
  to: Date;
}

/** Motor de proyecciones: resta los gastos programados futuros al patrimonio actual. */
export class ProjectionEngine {
  constructor(private readonly currency: string) {}

  project({ snapshot, scheduledExpenses, scheduledIncomes = [], from, to }: ProjectionInput): Projection {
    const commitments = this.expandCommitments(scheduledExpenses, from, to);
    const committed = Money.sum(commitments.map((c) => c.amount), this.currency);
    const availableBalance = snapshot.netWorth.subtract(committed);
    const incomes = this.expandIncomes(scheduledIncomes, from, to);
    const expectedIncome = Money.sum(incomes.map((i) => i.amount), this.currency);

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
      expectedIncome,
      availableWithIncome: availableBalance.add(expectedIncome),
      lowestWithIncome: this.lowestPoint(snapshot.netWorth, commitments, incomes, startOfDayUTC(from)),
      lastExpectedIncomeDate: incomes.reduce<Date | undefined>((last, i) => (!last || i.date.getTime() > last.getTime() ? i.date : last), undefined),
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

  private expandIncomes(incomes: readonly ScheduledIncome[], from: Date, to: Date): { date: Date; amount: Money }[] {
    return incomes.flatMap((si) => si.pendingOccurrences(from, to).map((date) => ({ date, amount: si.amount })));
  }

  /** Recorre día a día (ingresos antes que gastos del mismo día) y devuelve el saldo más bajo; en empate, el primero. */
  private lowestPoint(
    start: Money,
    commitments: Commitment[],
    incomes: { date: Date; amount: Money }[],
    from: Date,
  ): TimelinePoint {
    const events = [
      ...incomes.map((i) => ({ date: i.date, delta: i.amount.amount, order: 0 })),
      ...commitments.map((c) => ({ date: c.date, delta: -c.amount.amount, order: 1 })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime() || a.order - b.order);
    let balance = start.amount;
    let lowest: { date: Date; balance: bigint } = { date: from, balance };
    for (const e of events) {
      balance += e.delta;
      if (balance < lowest.balance) lowest = { date: e.date, balance };
    }
    return { date: lowest.date, balance: Money.of(lowest.balance, this.currency) };
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
