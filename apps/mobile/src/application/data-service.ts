import type { ActionResult } from '@finanzas/ui';
import { generateSampleData, isSampleId } from './sample-data';
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
      await this.ctx.ledger.replaceAll({
        accounts: all.accounts.filter((a) => !isSampleId(a.id)),
        transactions: all.transactions.filter((t) => !isSampleId(t.id) && !t.accountIds().some(isSampleId)),
        scheduledExpenses: all.scheduledExpenses.filter((s) => !isSampleId(s.id) && !isSampleId(s.accountId)),
      });
    });
  }

  /** Borra cuentas, movimientos y gastos programados. */
  eraseAll(): Promise<ActionResult> {
    return writeAction(this.ctx, () => this.ctx.ledger.clearAll());
  }
}
