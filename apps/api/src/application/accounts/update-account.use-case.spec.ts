import { DomainValidationError } from '@finanzas/domain';
import { EntityNotFoundError } from '../errors';
import { EventBus } from '../events/event-bus';
import { LedgerChangedEvent } from '../events/ledger-changed.event';
import { createInMemoryRepositories } from '../testing/in-memory';
import { CreateAccountUseCase } from './create-account.use-case';
import { UpdateAccountUseCase } from './update-account.use-case';

function setup() {
  const repos = createInMemoryRepositories();
  const bus = new EventBus();
  const events: LedgerChangedEvent[] = [];
  bus.subscribe(LedgerChangedEvent, (e) => void events.push(e));
  return {
    repos,
    events,
    create: new CreateAccountUseCase(repos.accounts, bus),
    update: new UpdateAccountUseCase(repos.accounts, bus),
  };
}

describe('UpdateAccountUseCase', () => {
  it('edita nombre, tipo y saldo inicial conservando el id y publica el evento', async () => {
    const { create, update, events, repos } = setup();
    const { id } = await create.execute({ name: 'Nu', type: 'DIGITAL', initialBalance: '100' });
    events.length = 0;
    const view = await update.execute(id, { name: 'Nu Bank', type: 'SAVINGS', initialBalance: '250000' });
    expect(view).toMatchObject({ id, name: 'Nu Bank', type: 'SAVINGS', initialBalance: { amount: '250000', currency: 'COP' } });
    expect(repos.accounts.items.size).toBe(1);
    expect(events).toEqual([new LedgerChangedEvent('account')]);
  });

  it('conserva los campos que no se envían', async () => {
    const { create, update } = setup();
    const { id } = await create.execute({ name: 'Nu', type: 'DIGITAL', initialBalance: '100' });
    expect(await update.execute(id, { name: 'Nu 2' })).toMatchObject({ name: 'Nu 2', type: 'DIGITAL', initialBalance: { amount: '100' } });
  });

  it('falla con EntityNotFoundError si no existe', async () => {
    const { update, events } = setup();
    await expect(update.execute('nope', { name: 'X' })).rejects.toThrow(EntityNotFoundError);
    expect(events).toHaveLength(0);
  });

  it('rechaza nombres vacíos sin publicar eventos', async () => {
    const { create, update, events } = setup();
    const { id } = await create.execute({ name: 'Nu', type: 'DIGITAL' });
    events.length = 0;
    await expect(update.execute(id, { name: '  ' })).rejects.toThrow(DomainValidationError);
    expect(events).toHaveLength(0);
  });
});
