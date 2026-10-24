import { DomainValidationError, UnknownAccountError } from '@finanzas/domain';
import { EntityNotFoundError, InvalidRequestError } from '../errors';
import { EventBus } from '../events/event-bus';
import { LedgerChangedEvent } from '../events/ledger-changed.event';
import { CreateAccountUseCase } from '../accounts/create-account.use-case';
import { FixedClock, createInMemoryRepositories } from '../testing/in-memory';
import { CreateTransactionUseCase } from './create-transaction.use-case';
import { DeleteTransactionUseCase } from './delete-transaction.use-case';
import { ListTransactionsUseCase } from './list-transactions.use-case';

async function setup() {
  const repos = createInMemoryRepositories();
  const bus = new EventBus();
  const events: LedgerChangedEvent[] = [];
  bus.subscribe(LedgerChangedEvent, (e) => void events.push(e));
  const clock = new FixedClock(new Date('2026-10-24T15:00:00Z'));
  const createAccount = new CreateAccountUseCase(repos.accounts, bus);
  const cash = await createAccount.execute({ name: 'Efectivo', type: 'CASH', initialBalance: '100000' });
  const bank = await createAccount.execute({ name: 'Bancolombia', type: 'BANK' });
  events.length = 0;
  return {
    repos,
    events,
    cash,
    bank,
    create: new CreateTransactionUseCase(repos.transactions, repos.accounts, bus, clock),
    remove: new DeleteTransactionUseCase(repos.transactions, bus),
    list: new ListTransactionsUseCase(repos.transactions),
  };
}

describe('CreateTransactionUseCase', () => {
  it('registra un ingreso y publica LedgerChangedEvent', async () => {
    const { create, cash, events, repos } = await setup();
    const view = await create.execute({ type: 'INCOME', accountId: cash.id, amount: '50000', description: 'Venta' });
    expect(view).toMatchObject({ type: 'INCOME', amount: { amount: '50000', currency: 'COP' }, accountId: cash.id, fromAccountId: null });
    expect(repos.transactions.items.size).toBe(1);
    expect(events).toEqual([new LedgerChangedEvent('transaction')]);
  });

  it('usa la fecha del reloj cuando no se especifica', async () => {
    const { create, cash } = await setup();
    const view = await create.execute({ type: 'EXPENSE', accountId: cash.id, amount: '1000', description: 'Café' });
    expect(view.date).toBe('2026-10-24T15:00:00.000Z');
  });

  it('registra una transferencia entre dos cuentas', async () => {
    const { create, cash, bank } = await setup();
    const view = await create.execute({ type: 'TRANSFER', fromAccountId: cash.id, toAccountId: bank.id, amount: '20000', description: 'Depósito' });
    expect(view).toMatchObject({ type: 'TRANSFER', fromAccountId: cash.id, toAccountId: bank.id, accountId: null });
  });

  it('falla con UnknownAccountError si la cuenta no existe y no guarda nada', async () => {
    const { create, repos, events } = await setup();
    await expect(create.execute({ type: 'INCOME', accountId: 'ghost', amount: '1', description: 'x' })).rejects.toThrow(UnknownAccountError);
    expect(repos.transactions.items.size).toBe(0);
    expect(events).toHaveLength(0);
  });

  it('falla si la cuenta destino de una transferencia no existe', async () => {
    const { create, cash } = await setup();
    await expect(
      create.execute({ type: 'TRANSFER', fromAccountId: cash.id, toAccountId: 'ghost', amount: '1', description: 'x' }),
    ).rejects.toThrow(UnknownAccountError);
  });

  it('falla con DomainValidationError si faltan cuentas para el tipo', async () => {
    const { create } = await setup();
    await expect(create.execute({ type: 'TRANSFER', amount: '1', description: 'x' })).rejects.toThrow(DomainValidationError);
    await expect(create.execute({ type: 'EXPENSE', amount: '1', description: 'x' })).rejects.toThrow(DomainValidationError);
  });

  it('rechaza montos no positivos', async () => {
    const { create, cash } = await setup();
    await expect(create.execute({ type: 'INCOME', accountId: cash.id, amount: '0', description: 'x' })).rejects.toThrow(DomainValidationError);
  });
});

describe('DeleteTransactionUseCase', () => {
  it('elimina la transacción y publica el evento', async () => {
    const { create, remove, cash, repos, events } = await setup();
    const { id } = await create.execute({ type: 'INCOME', accountId: cash.id, amount: '5', description: 'x' });
    events.length = 0;
    await remove.execute(id);
    expect(repos.transactions.items.size).toBe(0);
    expect(events).toEqual([new LedgerChangedEvent('transaction')]);
  });

  it('falla con EntityNotFoundError si no existe', async () => {
    const { remove } = await setup();
    await expect(remove.execute('nope')).rejects.toThrow(EntityNotFoundError);
  });
});

describe('ListTransactionsUseCase (paginación por cursor)', () => {
  async function seed() {
    const ctx = await setup();
    for (let day = 1; day <= 5; day++) {
      await ctx.create.execute({
        type: 'EXPENSE',
        accountId: ctx.cash.id,
        amount: String(day * 1000),
        date: `2026-10-0${day}T10:00:00Z`,
        description: `Gasto ${day}`,
      });
    }
    await ctx.create.execute({ type: 'INCOME', accountId: ctx.bank.id, amount: '9', date: '2026-10-10T10:00:00Z', description: 'Banco' });
    return ctx;
  }

  it('devuelve las más recientes primero con nextCursor cuando hay más', async () => {
    const { list } = await seed();
    const page = await list.execute({ limit: 2 });
    expect(page.items.map((t) => t.description)).toEqual(['Banco', 'Gasto 5']);
    expect(page.nextCursor).toEqual(expect.any(String));
  });

  it('recorre todo el historial sin repetir ni omitir y termina con nextCursor null', async () => {
    const { list } = await seed();
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list.execute({ limit: 4, cursor });
      seen.push(...page.items.map((t) => t.description));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual(['Banco', 'Gasto 5', 'Gasto 4', 'Gasto 3', 'Gasto 2', 'Gasto 1']);
  });

  it('filtra por cuenta', async () => {
    const { list, bank } = await seed();
    const page = await list.execute({ accountId: bank.id, limit: 10 });
    expect(page.items.map((t) => t.description)).toEqual(['Banco']);
    expect(page.nextCursor).toBeNull();
  });

  it('desempata por id cuando las fechas coinciden', async () => {
    const { create, list, cash } = await setup();
    for (let i = 0; i < 3; i++) {
      await create.execute({ type: 'INCOME', accountId: cash.id, amount: '1', date: '2026-10-01T00:00:00Z', description: `t${i}` });
    }
    const first = await list.execute({ limit: 2 });
    const second = await list.execute({ limit: 2, cursor: first.nextCursor! });
    const ids = [...first.items, ...second.items].map((t) => t.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids).toEqual([...ids].sort());
  });

  it('rechaza cursores corruptos con InvalidRequestError', async () => {
    const { list } = await setup();
    await expect(list.execute({ limit: 5, cursor: '%%%' })).rejects.toThrow(InvalidRequestError);
  });

  it('acota el límite al máximo permitido', async () => {
    const { list } = await seed();
    const page = await list.execute({ limit: 100_000 });
    expect(page.items).toHaveLength(6);
  });
});
