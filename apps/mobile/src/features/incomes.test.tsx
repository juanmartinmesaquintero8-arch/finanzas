import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppServices } from '@/application/create-services';
import { makeServices, renderWithServices } from '@/test-utils';
import { HomeScreen } from './HomeScreen';
import { ScheduledPage } from './ScheduledPage';

let search = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(search),
}));

let services: AppServices;
let accountId = '';
beforeEach(async () => {
  search = '';
  services = await makeServices();
  await services.accounts.create({ name: 'Bancolombia', type: 'BANK', initialBalance: '1000000' });
  accountId = (await services.accounts.list())[0]!.id;
});

describe('Programados: selector Gastos | Ingresos', () => {
  it('por defecto muestra los gastos y ofrece el selector', async () => {
    await renderWithServices(<ScheduledPage />, services);
    expect(await screen.findByRole('heading', { level: 1, name: 'Programados' })).toBeInTheDocument();
    const group = screen.getByRole('group', { name: 'Tipo' });
    expect(within(group).getByRole('link', { name: 'Gastos' })).toHaveAttribute('aria-current', 'true');
    expect(within(group).getByRole('link', { name: 'Ingresos' })).toHaveAttribute('href', '/programados?tipo=ingresos');
    expect(screen.getByRole('button', { name: '+ Nuevo gasto programado' })).toBeInTheDocument();
  });

  it('con tipo=ingresos muestra los ingresos y su estado vacío', async () => {
    search = 'tipo=ingresos';
    await renderWithServices(<ScheduledPage />, services);
    const group = await screen.findByRole('group', { name: 'Tipo' });
    expect(within(group).getByRole('link', { name: 'Ingresos' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByText('No tienes ingresos programados. Agrega tu sueldo o lo que recibes seguido.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Nuevo ingreso programado' })).toBeInTheDocument();
  });

  it('crea un ingreso desde el formulario, con categoría', async () => {
    search = 'tipo=ingresos';
    await renderWithServices(<ScheduledPage />, services);
    await userEvent.click(await screen.findByRole('button', { name: '+ Nuevo ingreso programado' }));
    await userEvent.type(await screen.findByLabelText('Descripción'), 'Sueldo');
    await userEvent.type(screen.getByLabelText('Monto'), '3000000');
    await userEvent.click(screen.getByRole('radio', { name: 'Bancolombia' }));
    await userEvent.type(screen.getByLabelText('Categoría (opcional)'), 'Salario');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('+ $ 3.000.000')).toBeInTheDocument();
    expect(await services.scheduledIncomes.list()).toHaveLength(1);
    expect((await services.scheduledIncomes.list())[0]).toMatchObject({ description: 'Sueldo', category: 'Salario', accountId });
    expect(await services.scheduled.list()).toEqual([]);
  });

  it('"Ya lo recibí" crea el ingreso real una sola vez', async () => {
    search = 'tipo=ingresos';
    await services.scheduledIncomes.create({ description: 'Sueldo', amount: '500000', accountId, frequency: 'ONCE', startDate: '2026-03-10', category: 'Salario' });
    await renderWithServices(<ScheduledPage />, services);
    const button = await screen.findByRole('button', { name: 'Ya lo recibí: Sueldo' });
    await userEvent.dblClick(button);
    await vi.waitFor(async () => expect((await services.transactions.page({})).items).toHaveLength(1));
    expect((await services.transactions.page({})).items[0]).toMatchObject({ type: 'INCOME', category: 'Salario', accountId });
    expect(await screen.findByText(/sin ingresos pendientes/i)).toBeInTheDocument();
    expect((await services.summary.projection('2026-03-31')).netWorth.amount).toBe('1500000');
  });

  it('los gastos programados piden categoría opcional y la guardan', async () => {
    await renderWithServices(<ScheduledPage />, services);
    await userEvent.click(await screen.findByRole('button', { name: '+ Nuevo gasto programado' }));
    await userEvent.type(await screen.findByLabelText('Descripción'), 'Arriendo');
    await userEvent.type(screen.getByLabelText('Monto'), '900000');
    await userEvent.click(screen.getByRole('radio', { name: 'Bancolombia' }));
    await userEvent.type(screen.getByLabelText('Categoría (opcional)'), 'Vivienda');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await vi.waitFor(async () => expect((await services.scheduled.list())[0]).toMatchObject({ description: 'Arriendo', category: 'Vivienda' }));
  });
});

describe('Inicio: lo que se espera recibir', () => {
  it('sin ingresos esperados no aparece nada nuevo', async () => {
    await renderWithServices(<HomeScreen />, services);
    expect(await screen.findByText('Saldo Real Disponible')).toBeInTheDocument();
    expect(screen.queryByText(/Si llega lo que esperas recibir/)).not.toBeInTheDocument();
  });

  it('con un ingreso esperado, el héroe no cambia y debajo se ve la línea secundaria', async () => {
    await services.scheduledIncomes.create({ description: 'Sueldo', amount: '500000', accountId, frequency: 'ONCE', startDate: '2026-03-20' });
    await renderWithServices(<HomeScreen />, services);
    const hero = await screen.findByRole('region', { name: 'Saldo Real Disponible' });
    expect(within(hero).getAllByText('$ 1.000.000').length).toBeGreaterThan(0);
    expect(screen.getByText('Si llega lo que esperas recibir: $ 1.500.000')).toBeInTheDocument();
    expect(screen.queryByText(/Ojo: el/)).not.toBeInTheDocument();
  });

  it('avisa el día en que faltaría plata antes de que llegue el ingreso', async () => {
    await services.scheduled.create({ description: 'Viaje', amount: '1300000', accountId, frequency: 'ONCE', startDate: '2026-03-12' });
    await services.scheduledIncomes.create({ description: 'Sueldo', amount: '2000000', accountId, frequency: 'ONCE', startDate: '2026-03-30' });
    await renderWithServices(<HomeScreen />, services);
    expect(await screen.findByText('Ojo: el jueves 12 de marzo te faltarían $ 300.000 antes de que llegue lo que esperas.')).toBeInTheDocument();
  });
});
