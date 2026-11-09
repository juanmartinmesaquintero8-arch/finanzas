import {
  DomainValidationError,
  TransactionFactory,
  UnknownAccountError,
  assertDomain,
  isMonthKey,
  normalizeCategory,
  type CreateTransactionInput as FactoryInput,
  type Transaction,
} from '@finanzas/domain';
import type { ActionResult, CreateTransactionInput, Transaction as TransactionView, TransactionPage } from '@finanzas/ui';
import { cardPaymentDescriber } from './card-payment-id';
import { decodeCursor, encodeCursor } from './cursor';
import { AppError, assertTextLength, notFound, parseMoney, writeAction, type ServiceContext } from './support';
import { toTransactionView } from './views';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/** Traduce la entrada del formulario a la Factory, exigiendo las cuentas que pide cada tipo. */
function toFactoryInput(id: string, date: Date, input: CreateTransactionInput): FactoryInput {
  assertTextLength('description', input.description);
  assertTextLength('category', input.category);
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
    return t ? this.withCardPayment([t]).then(([view]) => view!) : null;
  }

  /** Historial por cursor (keyset): pide una fila extra para saber si hay página siguiente. */
  async page(query: { accountId?: string; limit?: number; cursor?: string; month?: string; category?: string; until?: string } = {}): Promise<TransactionPage> {
    const limit = Math.min(Math.max(Math.trunc(query.limit ?? DEFAULT_PAGE_SIZE), 1), MAX_PAGE_SIZE);
    const after = query.cursor ? decodeCursor(query.cursor) : undefined;
    const month = isMonthKey(query.month) ? query.month : undefined;
    // La categoría solo se acepta junto con un mes: así la consulta siempre queda acotada.
    const categoryKey = month && query.category ? normalizeCategory(query.category).key : undefined;
    const until = query.until && /^\d{4}-\d{2}-\d{2}$/.test(query.until) ? query.until : undefined;
    const rows = await this.ctx.transactions.findPage({ accountId: query.accountId, limit: limit + 1, after, month, categoryKey, until });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    return {
      items: await this.withCardPayment(items),
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
      const payment = await cardPaymentDescriber(this.ctx)(id);
      if (payment) throw new AppError(payment.message);
      await this.save(id, input);
    });
  }

  remove(id: string): Promise<ActionResult> {
    return writeAction(this.ctx, async () => {
      if (!(await this.ctx.transactions.findById(id))) throw notFound('ese movimiento');
      const payment = await cardPaymentDescriber(this.ctx)(id);
      if (payment && !payment.canDelete) throw new AppError(payment.message);
      await this.ctx.transactions.delete(id);
    });
  }

  /** Marca los pagos de tarjeta: una sola consulta por compra o tarjeta, sin importar cuántos pagos tenga la página. */
  private withCardPayment(items: readonly Transaction[]): Promise<TransactionView[]> {
    const describe = cardPaymentDescriber(this.ctx);
    return Promise.all(
      items.map(async (t) => {
        const cardPayment = await describe(t.id);
        return cardPayment ? { ...toTransactionView(t), cardPayment } : toTransactionView(t);
      }),
    );
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
