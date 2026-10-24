import { DomainValidationError, UnknownAccountError } from '@finanzas/domain';
import { CreateAccountUseCase } from '../accounts/create-account.use-case';
import { EntityNotFoundError } from '../errors';
import { EventBus } from '../events/event-bus';
import { LedgerChangedEvent } from '../events/ledger-changed.event';
import { createInMemoryRepositories } from '../testing/in-memory';
import { CreateScheduledExpenseUseCase } from './create-scheduled-expense.use-case';
import { SettleScheduledExpenseUseCase } from './settle-scheduled-expense.use-case';
import { UpdateScheduledExpenseUseCase } from './update-scheduled-expense.use-case';

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
    settle: new SettleScheduledExpenseUseCase(repos.unitOfWork, bus),
    update: new UpdateScheduledExpenseUseCase(repos.scheduledExpenses, repos.accounts, bus),
  };
}

const rent = (accountId: string) => ({
  description: 'Arriendo',
  amount: '800000',
  accountId,
  frequency: 'MONTHLY' as const,
  startDate: '2026-11-05',
});

describe('UpdateScheduledExpenseUseCase', () => {
  it('edita todos los campos conservando el id y publica el evento', async () => {
    const { create, update, bank, events, repos } = await setup();
    const { id } = await create.execute(rent(bank.id));
    events.length = 0;
    const view = await update.execute(id, {
      description: 'Arriendo nuevo',
      amount: '900000',
      accountId: bank.id,
      frequency: 'WEEKLY',
      startDate: '2026-12-01',
      endDate: '2027-03-01',
    });
    expect(view).toMatchObject({
      id,
      description: 'Arriendo nuevo',
      amount: { amount: '900000' },
      frequency: 'WEEKLY',
      startDate: '2026-12-01',
      endDate: '2027-03-01',
    });
    expect(repos.scheduledExpenses.items.size).toBe(1);
    expect(events).toEqual([new LedgerChangedEvent('scheduled-expense')]);
  });

  it('quita la fecha de fin si no se envía', async () => {
    const { create, update, bank } = await setup();
    const { id } = await create.execute({ ...rent(bank.id), endDate: '2027-01-01' });
    expect((await update.execute(id, rent(bank.id))).endDate).toBeNull();
  });

  it('conserva lo ya liquidado (settledThrough)', async () => {
    const { create, update, settle, bank, repos } = await setup();
    const { id } = await create.execute(rent(bank.id));
    await settle.execute({ id, through: '2026-11-05' });
    const before = repos.scheduledExpenses.items.get(id)!.settledThrough;
    expect(before).toBeDefined();
    await update.execute(id, { ...rent(bank.id), amount: '1' });
    expect(repos.scheduledExpenses.items.get(id)!.settledThrough).toEqual(before);
  });

  it('falla con EntityNotFoundError si no existe', async () => {
    const { update, bank, events } = await setup();
    await expect(update.execute('nope', rent(bank.id))).rejects.toThrow(EntityNotFoundError);
    expect(events).toHaveLength(0);
  });

  it('falla con UnknownAccountError si la cuenta no existe', async () => {
    const { create, update, bank, events } = await setup();
    const { id } = await create.execute(rent(bank.id));
    events.length = 0;
    await expect(update.execute(id, rent('ghost'))).rejects.toThrow(UnknownAccountError);
    expect(events).toHaveLength(0);
  });

  it('aplica invariantes: monto positivo y fin posterior al inicio', async () => {
    const { create, update, bank } = await setup();
    const { id } = await create.execute(rent(bank.id));
    await expect(update.execute(id, { ...rent(bank.id), amount: '0' })).rejects.toThrow(DomainValidationError);
    await expect(update.execute(id, { ...rent(bank.id), endDate: '2026-01-01' })).rejects.toThrow(DomainValidationError);
  });
});
