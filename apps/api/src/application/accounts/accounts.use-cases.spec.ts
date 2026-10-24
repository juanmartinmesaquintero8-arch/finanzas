import { DomainValidationError, InvalidMoneyError } from '@finanzas/domain';
import { EntityNotFoundError } from '../errors';
import { EventBus } from '../events/event-bus';
import { LedgerChangedEvent } from '../events/ledger-changed.event';
import { createInMemoryRepositories } from '../testing/in-memory';
import { CreateAccountUseCase } from './create-account.use-case';
import { GetAccountUseCase } from './get-account.use-case';
import { ListAccountsUseCase } from './list-accounts.use-case';

function setup() {
  const repos = createInMemoryRepositories();
  const bus = new EventBus();
  const events: LedgerChangedEvent[] = [];
  bus.subscribe(LedgerChangedEvent, (e) => void events.push(e));
  return {
    repos,
    events,
    create: new CreateAccountUseCase(repos.accounts, bus),
    list: new ListAccountsUseCase(repos.accounts),
    get: new GetAccountUseCase(repos.accounts),
  };
}

describe('Casos de uso de cuentas', () => {
  it('crea una cuenta en COP por defecto con monto como string entero', async () => {
    const { create, repos } = setup();
    const view = await create.execute({ name: 'Bancolombia', type: 'BANK', initialBalance: '2000000' });
    expect(view).toMatchObject({ name: 'Bancolombia', type: 'BANK', initialBalance: { amount: '2000000', currency: 'COP' } });
    expect(view.id).toEqual(expect.any(String));
    expect(repos.accounts.items.size).toBe(1);
  });

  it('publica LedgerChangedEvent al crear una cuenta', async () => {
    const { create, events } = setup();
    await create.execute({ name: 'Nu', type: 'DIGITAL' });
    expect(events).toEqual([new LedgerChangedEvent('account')]);
  });

  it('el saldo inicial por defecto es cero', async () => {
    const { create } = setup();
    expect((await create.execute({ name: 'Efectivo', type: 'CASH' })).initialBalance.amount).toBe('0');
  });

  it('rechaza montos que no son enteros', async () => {
    const { create } = setup();
    await expect(create.execute({ name: 'X', type: 'CASH', initialBalance: '10.5' })).rejects.toThrow(InvalidMoneyError);
  });

  it('rechaza nombres vacíos (invariante de dominio)', async () => {
    const { create, events } = setup();
    await expect(create.execute({ name: '  ', type: 'CASH' })).rejects.toThrow(DomainValidationError);
    expect(events).toHaveLength(0);
  });

  it('lista las cuentas', async () => {
    const { create, list } = setup();
    await create.execute({ name: 'Efectivo', type: 'CASH' });
    await create.execute({ name: 'Nu', type: 'DIGITAL' });
    expect((await list.execute()).map((a) => a.name)).toEqual(['Efectivo', 'Nu']);
  });

  it('obtiene una cuenta por id y falla con EntityNotFoundError si no existe', async () => {
    const { create, get } = setup();
    const { id } = await create.execute({ name: 'Efectivo', type: 'CASH' });
    expect((await get.execute(id)).name).toBe('Efectivo');
    await expect(get.execute('nope')).rejects.toThrow(EntityNotFoundError);
  });
});
