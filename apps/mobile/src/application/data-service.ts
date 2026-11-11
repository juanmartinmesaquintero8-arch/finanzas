import type { ActionResult } from '@finanzas/ui';
import { generateSampleData, isSampleCardPaymentId, isSampleId } from './sample-data';
import { AppError, writeAction, type ServiceContext } from './support';

/** Estado general de los datos: ejemplos, borrado total. */
export class DataService {
  constructor(private readonly ctx: ServiceContext) {}

  async hasData(): Promise<boolean> {
    return (await this.ctx.accounts.findAll()).length > 0;
  }

  async hasSample(): Promise<boolean> {
    return (await this.ctx.accounts.findAll()).some((a) => isSampleId(a.id));
  }

  /** Sólo se ofrece con la app vacía, para no mezclar ejemplos con datos reales. */
  loadSample(): Promise<ActionResult> {
    return writeAction(this.ctx, async () => {
      if (await this.hasData()) throw new AppError('Ya tienes datos guardados, así que no cargamos los de ejemplo.');
      await this.ctx.ledger.replaceAll(generateSampleData(this.ctx.now()));
    });
  }

  /** Quita sólo lo de ejemplo (y lo que se haya registrado sobre sus cuentas); lo propio se queda. */
  removeSample(): Promise<ActionResult> {
    return writeAction(this.ctx, async () => {
      const all = await this.ctx.ledger.readAll();
      const extras = await this.ctx.ledger.readExtras();
      const keep = (row: { id: string }, ...refs: string[]) => ![row.id, ...refs].some(isSampleId);
      const keptCards = extras.creditCards.filter((c) => keep(c, c.paymentAccountId));
      const keptCardIds = new Set(keptCards.map((c) => c.id));
      // Un pago es de ejemplo si su id o su tarjeta lo es, o si se pagó desde una cuenta de ejemplo (sus
      // movimientos se van con esa cuenta). Quitarlo de una tarjeta que se queda dejaría su historial a medias
      // y el cálculo de la deuda fallaría: en ese caso no se quita nada y se pide deshacerlo primero.
      const broken = extras.cardPayments.find((p) => keptCardIds.has(p.cardId) && !keep(p, p.cardId, p.fromAccountId));
      if (broken) {
        const name = keptCards.find((c) => c.id === broken.cardId)!.name;
        throw new AppError(`Antes de quitar los datos de ejemplo, deshaz los pagos de la tarjeta «${name}» hechos desde una cuenta de ejemplo.`);
      }
      const keptPayments = extras.cardPayments.filter((p) => keptCardIds.has(p.cardId));
      await this.ctx.ledger.replaceAll(
        {
          accounts: all.accounts.filter((a) => !isSampleId(a.id)),
          transactions: all.transactions.filter((t) => !isSampleId(t.id) && !isSampleCardPaymentId(t.id) && !t.accountIds().some(isSampleId)),
          scheduledExpenses: all.scheduledExpenses.filter((s) => !isSampleId(s.id) && !isSampleId(s.accountId)),
          scheduledIncomes: all.scheduledIncomes.filter((i) => !isSampleId(i.id) && !isSampleId(i.accountId)),
        },
        {
          creditCards: keptCards,
          cardPurchases: extras.cardPurchases.filter((p) => !isSampleId(p.id) && keptCardIds.has(p.cardId)),
          cardPayments: keptPayments,
        },
      );
    });
  }

  /** Borra todo: cuentas, movimientos, gastos e ingresos programados, tarjetas, compras y pagos de tarjeta. */
  eraseAll(): Promise<ActionResult> {
    return writeAction(this.ctx, () => this.ctx.ledger.clearAll());
  }
}
