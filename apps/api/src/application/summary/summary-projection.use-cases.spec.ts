import { CreateAccountUseCase } from '../accounts/create-account.use-case';
import { CACHE_KEYS } from '../cache-keys';
import { InvalidRequestError } from '../errors';
import { EventBus } from '../events/event-bus';
import { InvalidateCachesOnLedgerChange } from '../events/invalidate-caches.listener';
import { CreateScheduledExpenseUseCase } from '../scheduled-expenses/create-scheduled-expense.use-case';
import { FixedClock, createInMemoryRepositories } from '../testing/in-memory';
import { CreateTransactionUseCase } from '../transactions/create-transaction.use-case';
import { InMemoryCache } from '../../infrastructure/cache/in-memory-cache';
import { GetProjectionUseCase } from './get-projection.use-case';
import { GetSummaryUseCase } from './get-summary.use-case';

async function setup() {
  const repos = createInMemoryRepositories();
  const bus = new EventBus();
  const cache = new InMemoryCache();
  new InvalidateCachesOnLedgerChange(bus, cache).onModuleInit();
  const clock = new FixedClock(new Date('2026-10-24T15:00:00Z'));

  const createAccount = new CreateAccountUseCase(repos.accounts, bus);
  const createTx = new CreateTransactionUseCase(repos.transactions, repos.accounts, bus, clock);
  const createScheduled = new CreateScheduledExpenseUseCase(repos.scheduledExpenses, repos.accounts, bus);

  const cash = await createAccount.execute({ name: 'Efectivo', type: 'CASH', initialBalance: '100000' });
  const bank = await createAccount.execute({ name: 'Bancolombia', type: 'BANK', initialBalance: '2000000' });
  const nu = await createAccount.execute({ name: 'Nu', type: 'DIGITAL' });

  return {
    repos,
    bus,
    cache,
    cash,
    bank,
    nu,
    createTx,
    createScheduled,
    summary: new GetSummaryUseCase(repos.accounts, repos.transactions, cache),
    projection: new GetProjectionUseCase(repos.accounts, repos.transactions, repos.scheduledExpenses, cache, clock),
  };
}

describe('GetSummaryUseCase', () => {
  it('devuelve patrimonio y saldo por cuenta derivados de totales agregados', async () => {
    const { summary, createTx, cash, bank, nu } = await setup();
    await createTx.execute({ type: 'INCOME', accountId: bank.id, amount: '3000000', description: 'Salario' });
    await createTx.execute({ type: 'EXPENSE', accountId: cash.id, amount: '40000', description: 'Almuerzo' });
    await createTx.execute({ type: 'TRANSFER', fromAccountId: bank.id, toAccountId: nu.id, amount: '1000000', description: 'Ahorro' });

    const result = await summary.execute();
    expect(result.netWorth).toEqual({ amount: '5060000', currency: 'COP' });
    expect(result.accounts).toEqual([
      { accountId: cash.id, name: 'Efectivo', type: 'CASH', balance: { amount: '60000', currency: 'COP' } },
      { accountId: bank.id, name: 'Bancolombia', type: 'BANK', balance: { amount: '4000000', currency: 'COP' } },
      { accountId: nu.id, name: 'Nu', type: 'DIGITAL', balance: { amount: '1000000', currency: 'COP' } },
    ]);
  });

  it('una transferencia no cambia el patrimonio', async () => {
    const { summary, createTx, bank, nu } = await setup();
    const before = (await summary.execute()).netWorth;
    await createTx.execute({ type: 'TRANSFER', fromAccountId: bank.id, toAccountId: nu.id, amount: '500000', description: 'x' });
    expect((await summary.execute()).netWorth).toEqual(before);
  });

  it('sirve desde caché sin volver a consultar la base de datos', async () => {
    const { summary, repos, cache } = await setup();
    await summary.execute();
    await summary.execute();
    expect(repos.transactions.balanceDeltasCalls).toBe(1);
    expect(await cache.get(CACHE_KEYS.summary())).toBeDefined();
  });

  it('INVALIDACIÓN: tras escribir una transacción el resumen refleja el dato nuevo', async () => {
    const { summary, createTx, cash } = await setup();
    expect((await summary.execute()).netWorth.amount).toBe('2100000');
    await createTx.execute({ type: 'INCOME', accountId: cash.id, amount: '900000', description: 'Bono' });
    expect((await summary.execute()).netWorth.amount).toBe('3000000');
  });

  it('INVALIDACIÓN: crear una cuenta nueva invalida el resumen', async () => {
    const { summary, repos, bus } = await setup();
    await summary.execute();
    await new CreateAccountUseCase(repos.accounts, bus).execute({ name: 'Ahorros', type: 'SAVINGS', initialBalance: '5' });
    expect((await summary.execute()).accounts).toHaveLength(4);
  });
});

describe('GetProjectionUseCase', () => {
  it('calcula el Saldo Real Disponible restando gastos programados pendientes hasta la fecha de corte', async () => {
    const { projection, createScheduled, bank } = await setup();
    await createScheduled.execute({ description: 'Arriendo', amount: '800000', accountId: bank.id, frequency: 'MONTHLY', startDate: '2026-11-05' });

    const result = await projection.execute({ to: '2027-01-31' });
    // Patrimonio 2.100.000 − arriendo (nov, dic, ene) 2.400.000
    expect(result.netWorth).toEqual({ amount: '2100000', currency: 'COP' });
    expect(result.committed).toEqual({ amount: '2400000', currency: 'COP' });
    expect(result.availableBalance).toEqual({ amount: '-300000', currency: 'COP' });
    expect(result.isShortfall).toBe(true);
    expect(result.from).toBe('2026-10-24');
    expect(result.commitments.map((c) => c.date)).toEqual(['2026-11-05', '2026-12-05', '2027-01-05']);
    expect(result.accounts.find((a) => a.accountId === bank.id)).toMatchObject({
      name: 'Bancolombia',
      balance: { amount: '2000000', currency: 'COP' },
      committed: { amount: '2400000', currency: 'COP' },
      available: { amount: '-400000', currency: 'COP' },
    });
  });

  it('rechaza horizontes mayores a 24 meses', async () => {
    const { projection } = await setup();
    await expect(projection.execute({ to: '2028-10-24' })).resolves.toBeDefined();
    await expect(projection.execute({ to: '2028-10-25' })).rejects.toThrow(InvalidRequestError);
  });

  it('rechaza una fecha de corte anterior a hoy', async () => {
    const { projection } = await setup();
    await expect(projection.execute({ to: '2026-10-23' })).rejects.toThrow(InvalidRequestError);
  });

  it('rechaza fechas con formato inválido', async () => {
    const { projection } = await setup();
    await expect(projection.execute({ to: 'mañana' })).rejects.toThrow();
  });

  it('cachea por (from, to) y reutiliza el resultado', async () => {
    const { projection, repos, cache } = await setup();
    await projection.execute({ to: '2026-12-31' });
    await projection.execute({ to: '2026-12-31' });
    expect(repos.transactions.balanceDeltasCalls).toBe(1);
    expect(await cache.get(CACHE_KEYS.projection('2026-10-24', '2026-12-31'))).toBeDefined();
  });

  it('INVALIDACIÓN: un gasto programado nuevo cambia la proyección cacheada', async () => {
    const { projection, createScheduled, bank } = await setup();
    expect((await projection.execute({ to: '2026-12-31' })).committed.amount).toBe('0');
    await createScheduled.execute({ description: 'Internet', amount: '100000', accountId: bank.id, frequency: 'ONCE', startDate: '2026-11-15' });
    expect((await projection.execute({ to: '2026-12-31' })).committed.amount).toBe('100000');
  });
});
