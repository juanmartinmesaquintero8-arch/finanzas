import { DomainValidationError, UnknownAccountError } from '@finanzas/domain';
import { CreateAccountUseCase } from '../accounts/create-account.use-case';
import { EntityNotFoundError } from '../errors';
import { EventBus } from '../events/event-bus';
import { LedgerChangedEvent } from '../events/ledger-changed.event';
import { createInMemoryRepositories } from '../testing/in-memory';
import { CreateScheduledExpenseUseCase } from './create-scheduled-expense.use-case';
import { DeleteScheduledExpenseUseCase } from './delete-scheduled-expense.use-case';
import { ListScheduledExpensesUseCase } from './list-scheduled-expenses.use-case';
import { SettleScheduledExpenseUseCase } from './settle-scheduled-expense.use-case';

async function setup() {
  const repos = createInMemoryRepositories();
  const bus = new EventBus();
  const events: LedgerChangedEvent[] = [];
  bus.subscribe(LedgerChangedEvent, (e) => void events.push(e));
  const bank = await new CreateAccountUseCase(repos.accounts, bus).execute({ name: 'Bancolombia', type: 'BANK', initialBalance: '1000000' });
  events.length = 0;
  return {
    repos,
    events,
    bank,
    create: new CreateScheduledExpenseUseCase(repos.scheduledExpenses, repos.accounts, bus),
    list: new ListScheduledExpensesUseCase(repos.scheduledExpenses),
    remove: new DeleteScheduledExpenseUseCase(repos.scheduledExpenses, bus),
    settle: new SettleScheduledExpenseUseCase(repos.unitOfWork, bus),
  };
}

const rent = (accountId: string) => ({
  description: 'Arriendo',
  amount: '800000',
  accountId,
  frequency: 'MONTHLY' as const,
  startDate: '2026-11-05',
});

describe('Gastos programados', () => {
  it('crea un gasto programado y publica el evento', async () => {
    const { create, bank, events } = await setup();
    const view = await create.execute(rent(bank.id));
    expect(view).toMatchObject({
      description: 'Arriendo',
      amount: { amount: '800000', currency: 'COP' },
      frequency: 'MONTHLY',
      startDate: '2026-11-05',
      endDate: null,
      settledThrough: null,
    });
    expect(events).toEqual([new LedgerChangedEvent('scheduled-expense')]);
  });

  it('falla si la cuenta no existe', async () => {
    const { create } = await setup();
    await expect(create.execute(rent('ghost'))).rejects.toThrow(UnknownAccountError);
  });

  it('rechaza montos no positivos', async () => {
    const { create, bank } = await setup();
    await expect(create.execute({ ...rent(bank.id), amount: '0' })).rejects.toThrow(DomainValidationError);
  });

  it('lista y elimina gastos programados', async () => {
    const { create, list, remove, bank, events } = await setup();
    const { id } = await create.execute(rent(bank.id));
    expect(await list.execute()).toHaveLength(1);
    events.length = 0;
    await remove.execute(id);
    expect(await list.execute()).toHaveLength(0);
    expect(events).toEqual([new LedgerChangedEvent('scheduled-expense')]);
    await expect(remove.execute(id)).rejects.toThrow(EntityNotFoundError);
  });
});

describe('SettleScheduledExpenseUseCase', () => {
  it('marca el gasto como liquidado hasta la fecha sin crear transacciones por defecto', async () => {
    const { create, settle, bank, repos, events } = await setup();
    const { id } = await create.execute(rent(bank.id));
    events.length = 0;
    const view = await settle.execute({ id, through: '2026-12-31' });
    expect(view.settledThrough).toBe('2026-12-31');
    expect(repos.transactions.items.size).toBe(0);
    expect(events).toEqual([new LedgerChangedEvent('scheduled-expense')]);
  });

  it('con createTransactions crea un gasto real por cada ocurrencia liquidada', async () => {
    const { create, settle, bank, repos, events } = await setup();
    const { id } = await create.execute(rent(bank.id));
    events.length = 0;
    const view = await settle.execute({ id, through: '2026-12-31', createTransactions: true });
    const created = [...repos.transactions.items.values()];
    expect(created.map((t) => t.date.toISOString().slice(0, 10)).sort()).toEqual(['2026-11-05', '2026-12-05']);
    expect(created.every((t) => t.type === 'EXPENSE' && t.amount.amount === 800000n)).toBe(true);
    expect(view.settledThrough).toBe('2026-12-31');
    expect(events).toEqual([new LedgerChangedEvent('transaction'), new LedgerChangedEvent('scheduled-expense')]);
  });

  it('no duplica transacciones al liquidar de nuevo un tramo ya liquidado', async () => {
    const { create, settle, bank, repos } = await setup();
    const { id } = await create.execute(rent(bank.id));
    await settle.execute({ id, through: '2026-11-30', createTransactions: true });
    await settle.execute({ id, through: '2026-12-31', createTransactions: true });
    expect(repos.transactions.items.size).toBe(2);
  });

  it('rechaza liquidar hasta una fecha anterior a la ya liquidada', async () => {
    const { create, settle, bank } = await setup();
    const { id } = await create.execute(rent(bank.id));
    await settle.execute({ id, through: '2026-12-31' });
    await expect(settle.execute({ id, through: '2026-11-30' })).rejects.toThrow(DomainValidationError);
  });

  it('falla con EntityNotFoundError si el gasto no existe', async () => {
    const { settle } = await setup();
    await expect(settle.execute({ id: 'nope', through: '2026-12-31' })).rejects.toThrow(EntityNotFoundError);
  });
});
