import { Account } from '@finanzas/domain';
import type { ActionResult, Account as AccountView, CreateAccountInput, UpdateAccountInput } from '@finanzas/ui';
import { AppError, notFound, parseMoney, writeAction, type ServiceContext } from './support';
import { toAccountView } from './views';

export class AccountService {
  constructor(private readonly ctx: ServiceContext) {}

  async list(): Promise<AccountView[]> {
    return (await this.ctx.accounts.findAll()).map(toAccountView);
  }

  create(input: CreateAccountInput): Promise<ActionResult> {
    return writeAction(this.ctx, () =>
      this.ctx.accounts.save(
        Account.create({
          id: this.ctx.newId(),
          name: input.name,
          type: input.type,
          initialBalance: parseMoney(input.initialBalance || '0'),
        }),
      ),
    );
  }

  update(id: string, input: UpdateAccountInput): Promise<ActionResult> {
    return writeAction(this.ctx, async () => {
      if (!(await this.ctx.accounts.findById(id))) throw notFound('esa cuenta');
      await this.ctx.accounts.save(
        Account.create({ id, name: input.name, type: input.type, initialBalance: parseMoney(input.initialBalance || '0') }),
      );
    });
  }

  /** Sólo se puede borrar una cuenta que ya no tiene nada asociado (el saldo se deriva de sus movimientos). */
  remove(id: string): Promise<ActionResult> {
    return writeAction(this.ctx, async () => {
      if (!(await this.ctx.accounts.findById(id))) throw notFound('esa cuenta');
      if ((await this.ctx.transactions.findPage({ accountId: id, limit: 1 })).length > 0) {
        throw new AppError('Esta cuenta tiene movimientos. Elimínalos primero para poder borrarla.');
      }
      if ((await this.ctx.scheduled.findAll()).some((s) => s.accountId === id)) {
        throw new AppError('Esta cuenta tiene gastos programados. Elimínalos primero para poder borrarla.');
      }
      await this.ctx.accounts.delete(id);
    });
  }
}
