import { DomainValidationError, UnknownAccountError } from '@finanzas/domain';
import { CreateAccountUseCase } from '../accounts/create-account.use-case';
import { EntityNotFoundError } from '../errors';
import { EventBus } from '../events/event-bus';
import { LedgerChangedEvent } from '../events/ledger-changed.event';
import { FixedClock, createInMemoryRepositories } from '../testing/in-memory';
import { CreateTransactionUseCase } from './create-transaction.use-case';
import { GetTransactionUseCase } from './get-transaction.use-case';
import { UpdateTransactionUseCase } from './update-transaction.use-case';

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
    get: new GetTransactionUseCase(repos.transactions),
    update: new UpdateTransactionUseCase(repos.transactions, repos.accounts, bus),
  };
}

describe('GetTransactionUseCase', () => {
  it('devuelve la transacción por id', async () => {
    const { create, get, cash } = await setup();
    const { id } = await create.execute({ type: 'EXPENSE', accountId: cash.id, amount: '700', description: 'Pan' });
    expect(await get.execute(id)).toMatchObject({ id, description: 'Pan', amount: { amount: '700', currency: 'COP' } });
  });

  it('falla con EntityNotFoundError si no existe', async () => {
    const { get } = await setup();
    await expect(get.execute('nope')).rejects.toThrow(EntityNotFoundError);
  });
});

describe('UpdateTransactionUseCase', () => {
  it('edita monto, fecha, descripción y categoría conservando el id, y publica el evento', async () => {
    const { create, update, cash, events, repos } = await setup();
    const { id } = await create.execute({ type: 'EXPENSE', accountId: cash.id, amount: '700', description: 'Pan', category: 'Comida' });
    events.length = 0;
    const view = await update.execute(id, {
      type: 'EXPENSE',
      accountId: cash.id,
      amount: '900',
      date: '2026-10-20T10:00:00Z',
      description: 'Pan y leche',
      category: 'Mercado',
    });
    expect(view).toMatchObject({
      id,
      amount: { amount: '900' },
      description: 'Pan y leche',
      category: 'Mercado',
      date: '2026-10-20T10:00:00.000Z',
    });
    expect(repos.transactions.items.size).toBe(1);
    expect(events).toEqual([new LedgerChangedEvent('transaction')]);
  });

  it('permite cambiar el tipo de gasto a transferencia', async () => {
    const { create, update, cash, bank } = await setup();
    const { id } = await create.execute({ type: 'EXPENSE', accountId: cash.id, amount: '700', description: 'x' });
    const view = await update.execute(id, { type: 'TRANSFER', fromAccountId: cash.id, toAccountId: bank.id, amount: '700', description: 'x' });
    expect(view).toMatchObject({ id, type: 'TRANSFER', accountId: null, fromAccountId: cash.id, toAccountId: bank.id });
  });

  it('permite cambiar la cuenta', async () => {
    const { create, update, cash, bank } = await setup();
    const { id } = await create.execute({ type: 'INCOME', accountId: cash.id, amount: '5', description: 'x' });
    expect(await update.execute(id, { type: 'INCOME', accountId: bank.id, amount: '5', description: 'x' })).toMatchObject({
      accountId: bank.id,
    });
  });

  it('conserva la fecha original si no se envía una nueva', async () => {
    const { create, update, cash } = await setup();
    const { id, date } = await create.execute({ type: 'INCOME', accountId: cash.id, amount: '5', date: '2026-09-01T08:00:00Z', description: 'x' });
    expect((await update.execute(id, { type: 'INCOME', accountId: cash.id, amount: '6', description: 'x' })).date).toBe(date);
  });

  it('falla con EntityNotFoundError si no existe y no publica nada', async () => {
    const { update, cash, events } = await setup();
    await expect(update.execute('nope', { type: 'INCOME', accountId: cash.id, amount: '1', description: 'x' })).rejects.toThrow(
      EntityNotFoundError,
    );
    expect(events).toHaveLength(0);
  });

  it('falla con UnknownAccountError si la nueva cuenta no existe y deja la transacción intacta', async () => {
    const { create, update, cash, events, repos } = await setup();
    const { id } = await create.execute({ type: 'INCOME', accountId: cash.id, amount: '5', description: 'x' });
    events.length = 0;
    await expect(update.execute(id, { type: 'INCOME', accountId: 'ghost', amount: '5', description: 'x' })).rejects.toThrow(
      UnknownAccountError,
    );
    expect(repos.transactions.items.get(id)).toMatchObject({ accountId: cash.id });
    expect(events).toHaveLength(0);
  });

  it('aplica las invariantes del dominio (monto positivo, cuentas distintas)', async () => {
    const { create, update, cash } = await setup();
    const { id } = await create.execute({ type: 'INCOME', accountId: cash.id, amount: '5', description: 'x' });
    await expect(update.execute(id, { type: 'INCOME', accountId: cash.id, amount: '0', description: 'x' })).rejects.toThrow(
      DomainValidationError,
    );
    await expect(
      update.execute(id, { type: 'TRANSFER', fromAccountId: cash.id, toAccountId: cash.id, amount: '1', description: 'x' }),
    ).rejects.toThrow(DomainValidationError);
  });
});
