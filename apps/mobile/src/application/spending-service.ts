import {
  addMonths,
  buildBreakdown,
  clampSpendingMonth,
  createSpendingAccumulator,
  daysInMonth,
  spendingWindow,
} from '@finanzas/domain';
import { todayISO, type SpendingView } from '@finanzas/ui';
import type { ServiceContext } from './support';

/** Cede el hilo al navegador para que la pantalla no se congele entre lotes. */
const yieldThread = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * "En qué gasto": suma los gastos de un mes por categoría y los compara con el mes anterior.
 * Lee solo el mes pedido y el anterior, por lotes y sin crear entidades; el resultado se memoiza
 * por versión de datos (se renueva solo cuando algún servicio escribe).
 */
export class SpendingService {
  private version = -1;
  private cache = new Map<string, Promise<SpendingView>>();

  constructor(private readonly ctx: ServiceContext) {}

  month(requested: string | null | undefined): Promise<SpendingView> {
    if (this.version !== this.ctx.bus.version) {
      this.version = this.ctx.bus.version;
      this.cache = new Map();
    }
    const today = todayISO(this.ctx.now());
    const month = clampSpendingMonth(requested, today);
    const key = `${today}|${month}`;
    let cached = this.cache.get(key);
    if (!cached) {
      cached = this.compute(month, today);
      this.cache.set(key, cached);
      // Un fallo no se queda guardado: el siguiente intento vuelve a leer.
      cached.catch(() => this.cache.delete(key));
    }
    return cached;
  }

  private async compute(month: string, today: string): Promise<SpendingView> {
    const { current, oldest } = spendingWindow(today);
    const previousMonth = addMonths(month, -1);
    const isCurrent = month === current;
    // Mes en curso: solo los mismos días del mes anterior (si hoy es 8, del 1 al 8; 31 de marzo contra todo febrero).
    const comparedUntilDay = isCurrent ? Number(today.slice(8, 10)) : null;
    const lastComparedDay = comparedUntilDay === null ? Infinity : Math.min(comparedUntilDay, daysInMonth(previousMonth));

    const acc = createSpendingAccumulator();
    await this.ctx.ledger.scanTransactionsByDate(previousMonth, `${month}￿`, async (rows) => {
      for (const row of rows) {
        if (row.type !== 'EXPENSE') continue;
        if (row.date.startsWith(previousMonth) && Number(row.date.slice(8, 10)) > lastComparedDay) continue;
        acc.add({ type: row.type, amount: BigInt(row.amount), isoDate: row.date, category: row.category });
      }
      await yieldThread();
    });

    const { months, labels } = acc.result();
    const previous = months.get(previousMonth);
    const breakdown = buildBreakdown(months.get(month) ?? { total: 0n, byCategory: new Map() }, previous && previous.total > 0n ? previous : undefined, labels);

    return {
      month,
      previousMonth,
      isCurrent,
      comparedUntilDay,
      oldestMonth: oldest,
      currentMonth: current,
      total: breakdown.total.toString(),
      previousTotal: breakdown.previousTotal?.toString() ?? null,
      totalDelta: breakdown.previousTotal === undefined ? null : (breakdown.total - breakdown.previousTotal).toString(),
      rows: breakdown.rows.map((r) => ({
        key: r.key,
        label: r.label,
        kind: r.kind,
        amount: r.amount.toString(),
        percent: r.percent,
        barPct: r.barPct,
        previousMarkPct: r.previousMarkPct,
        delta: r.delta?.toString() ?? null,
        isNew: r.isNew,
      })),
    };
  }
}
