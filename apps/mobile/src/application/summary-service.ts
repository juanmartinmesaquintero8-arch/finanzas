import {
  BalanceCalculator,
  ProjectionEngine,
  startOfDayUTC,
  type Account,
  type BalanceSnapshot,
  type ScheduledExpense,
} from '@finanzas/domain';
import { todayISO, type Projection } from '@finanzas/ui';
import { CURRENCY, isoDay, parseDay, type ServiceContext } from './support';

interface Base {
  accounts: Account[];
  snapshot: BalanceSnapshot;
  scheduled: ScheduledExpense[];
}

/**
 * Resumen y proyección (Saldo Real Disponible). Los cálculos se memoizan por versión de datos:
 * se invalidan solos cuando cualquier servicio escribe (ChangeBus), y cambiar de horizonte
 * reutiliza los saldos ya calculados.
 */
export class SummaryService {
  private readonly calculator = new BalanceCalculator(CURRENCY);
  private readonly engine = new ProjectionEngine(CURRENCY);
  private version = -1;
  private base?: Promise<Base>;
  private projections = new Map<string, Promise<Projection>>();

  constructor(private readonly ctx: ServiceContext) {}

  projection(to: string): Promise<Projection> {
    this.syncVersion();
    const from = parseDay(todayISO(this.ctx.now()));
    const target = parseDay(to);
    const cutoff = target.getTime() < from.getTime() ? from : target;
    const key = `${isoDay(from)}:${isoDay(cutoff)}`;
    let cached = this.projections.get(key);
    if (!cached) {
      cached = this.compute(from, cutoff);
      this.projections.set(key, cached);
    }
    return cached;
  }

  private syncVersion(): void {
    if (this.version === this.ctx.bus.version) return;
    this.version = this.ctx.bus.version;
    this.base = undefined;
    this.projections = new Map();
  }

  private loadBase(): Promise<Base> {
    this.base ??= (async () => {
      const [accounts, deltas, scheduled] = await Promise.all([
        this.ctx.accounts.findAll(),
        this.ctx.transactions.balanceDeltas(),
        this.ctx.scheduled.findAll(),
      ]);
      return { accounts, snapshot: this.calculator.fromTotals(accounts, deltas), scheduled };
    })();
    return this.base;
  }

  private async compute(from: Date, to: Date): Promise<Projection> {
    const { accounts, snapshot, scheduled } = await this.loadBase();
    const projection = this.engine.project({ snapshot, scheduledExpenses: scheduled, from: startOfDayUTC(from), to });
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
