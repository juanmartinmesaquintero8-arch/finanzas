import {
  DomainValidationError,
  TransactionFactory,
  UnknownAccountError,
  assertDomain,
  type CreateTransactionInput as FactoryInput,
} from '@finanzas/domain';
import type { ActionResult, CreateTransactionInput, Transaction as TransactionView, TransactionPage } from '@finanzas/ui';
import { decodeCursor, encodeCursor } from './cursor';
import { notFound, parseMoney, writeAction, type ServiceContext } from './support';
import { toTransactionView } from './views';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/** Traduce la entrada del formulario a la Factory, exigiendo las cuentas que pide cada tipo. */
function toFactoryInput(id: string, date: Date, input: CreateTransactionInput): FactoryInput {
  const common = { id, amount: parseMoney(input.amount), date, description: input.description, category: input.category };
  if (input.type === 'TRANSFER') {
    assertDomain(!!input.fromAccountId && !!input.toAccountId, 'La transferencia requiere cuenta de origen y de destino');
    return { ...common, type: 'TRANSFER', fromAccountId: input.fromAccountId!, toAccountId: input.toAccountId! };
  }
  if (input.type === 'INCOME' || input.type === 'EXPENSE') {
    assertDomain(!!input.accountId, 'El ingreso o gasto requiere una cuenta');
    return { ...common, type: input.type, accountId: input.accountId! };
  }
  throw new DomainValidationError(`Tipo de movimiento inválido: ${String(input.type)}`);
}

export class TransactionService {
  constructor(private readonly ctx: ServiceContext) {}

  async get(id: string): Promise<TransactionView | null> {
    const t = await this.ctx.transactions.findById(id);
    return t ? toTransactionView(t) : null;
  }

  /** Historial por cursor (keyset): pide una fila extra para saber si hay página siguiente. */
  async page(query: { accountId?: string; limit?: number; cursor?: string } = {}): Promise<TransactionPage> {
    const limit = Math.min(Math.max(Math.trunc(query.limit ?? DEFAULT_PAGE_SIZE), 1), MAX_PAGE_SIZE);
    const after = query.cursor ? decodeCursor(query.cursor) : undefined;
    const rows = await this.ctx.transactions.findPage({ accountId: query.accountId, limit: limit + 1, after });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    return {
      items: items.map(toTransactionView),
      nextCursor: hasMore && last ? encodeCursor({ date: last.date, id: last.id }) : null,
    };
  }

  create(input: CreateTransactionInput): Promise<ActionResult> {
    return writeAction(this.ctx, () => this.save(this.ctx.newId(), input));
  }

  /** Reemplaza el movimiento reconstruyéndolo con la Factory, así se aplican todas las reglas aunque cambie el tipo. */
  update(id: string, input: CreateTransactionInput): Promise<ActionResult> {
    return writeAction(this.ctx, async () => {
      if (!(await this.ctx.transactions.findById(id))) throw notFound('ese movimiento');
      await this.save(id, input);
    });
  }

  remove(id: string): Promise<ActionResult> {
    return writeAction(this.ctx, async () => {
      if (!(await this.ctx.transactions.findById(id))) throw notFound('ese movimiento');
      await this.ctx.transactions.delete(id);
    });
  }

  private async save(id: string, input: CreateTransactionInput): Promise<void> {
    const factoryInput = toFactoryInput(id, new Date(input.date), input);
    const ids = factoryInput.type === 'TRANSFER' ? [factoryInput.fromAccountId, factoryInput.toAccountId] : [factoryInput.accountId];
    for (const accountId of ids) {
      if (!(await this.ctx.accounts.findById(accountId))) throw new UnknownAccountError(accountId);
    }
    await this.ctx.transactions.save(TransactionFactory.create(factoryInput));
  }
}
