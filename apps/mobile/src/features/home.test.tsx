import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppServices } from '@/application/create-services';
import { makeServices, renderWithServices } from '@/test-utils';
import { AddScreen } from './AddScreen';
import { HistoryScreen } from './HistoryScreen';
import { HomeScreen } from './HomeScreen';
import { NewAccountScreen } from './NewAccountScreen';
import { ScheduledPage } from './ScheduledPage';
import { WelcomeCard } from './WelcomeCard';

const push = vi.fn();
let search = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(search),
}));

let services: AppServices;
beforeEach(async () => {
  push.mockReset();
  search = '';
  services = await makeServices();
});

describe('WelcomeCard (primer uso)', () => {
  it('invita a crear la primera cuenta y ofrece los datos de ejemplo', async () => {
    const onLoadSample = vi.fn().mockResolvedValue({ ok: true });
    const { render } = await import('@testing-library/react');
    render(<WelcomeCard onLoadSample={onLoadSample} />);
    expect(screen.getByRole('heading', { name: /bienvenido/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Crea tu primera cuenta' })).toHaveAttribute('href', '/cuentas/nueva');
    expect(screen.getByText(/solo en este celular/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ver con datos de ejemplo' }));
    expect(onLoadSample).toHaveBeenCalledOnce();
  });

  it('muestra el error si no se pudieron cargar los ejemplos', async () => {
    const { render } = await import('@testing-library/react');
    render(<WelcomeCard onLoadSample={vi.fn().mockResolvedValue({ ok: false, error: 'Ya tienes datos' })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ver con datos de ejemplo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ya tienes datos');
  });
});

describe('Inicio', () => {
  it('sin datos muestra la bienvenida; los ejemplos llevan al resumen y se pueden quitar', async () => {
    await renderWithServices(<HomeScreen />, services);
    expect(await screen.findByRole('link', { name: 'Crea tu primera cuenta' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Ver con datos de ejemplo' }));
    expect(await screen.findByText('Saldo Real Disponible')).toBeInTheDocument();
    expect(screen.getByText(/estás viendo datos de ejemplo/i)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Tus cuentas' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Borrar datos de ejemplo' }));
    expect(await screen.findByRole('link', { name: 'Crea tu primera cuenta' })).toBeInTheDocument();
  });

  it('calcula el Saldo Real Disponible con la proyección y cambia de horizonte con los chips', async () => {
    await services.accounts.create({ name: 'Nu', type: 'DIGITAL', initialBalance: '1000000' });
    const [a] = await services.accounts.list();
    await services.scheduled.create({ description: 'Arriendo', amount: '400000', accountId: a!.id, frequency: 'MONTHLY', startDate: '2026-03-20' });
    await renderWithServices(<HomeScreen />, services);
    expect((await screen.findAllByText('$ 600.000')).length).toBeGreaterThan(0); // disponible a fin de mes
    expect(screen.getByText('Arriendo')).toBeInTheDocument();
    const group = screen.getByRole('group', { name: /horizonte/i });
    expect(within(group).getByRole('link', { name: '3 meses' })).toHaveAttribute('href', '/?h=3m');
  });

  it('usa el horizonte de la dirección (?h=3m)', async () => {
    search = 'h=3m';
    await services.accounts.create({ name: 'Nu', type: 'DIGITAL', initialBalance: '1000000' });
    const [a] = await services.accounts.list();
    await services.scheduled.create({ description: 'Arriendo', amount: '400000', accountId: a!.id, frequency: 'MONTHLY', startDate: '2026-03-20' });
    await renderWithServices(<HomeScreen />, services);
    // 20 mar, 20 abr, 20 may, 20 jun (corte 10 jun: no entra) -> 3 pagos
    expect((await screen.findAllByText('-$ 200.000')).length).toBeGreaterThan(0);
    expect(screen.getByRole('alert')).toHaveTextContent(/no te alcanza/i);
  });

  it('muestra el recordatorio de copia sólo cuando corresponde y enlaza a Ajustes', async () => {
    await services.accounts.create({ name: 'Nu', type: 'DIGITAL', initialBalance: '1' });
    await renderWithServices(<HomeScreen />, services);
    const reminder = await screen.findByRole('link', { name: /hacer mi copia/i });
    expect(reminder).toHaveAttribute('href', '/ajustes');
    expect(screen.getByText(/nunca has hecho una copia/i)).toBeInTheDocument();
  });

  it('el recordatorio desaparece tras hacer la copia', async () => {
    await services.accounts.create({ name: 'Nu', type: 'DIGITAL', initialBalance: '1' });
    await services.backup.markDone(new Date('2026-03-09T00:00:00Z').toISOString());
    await renderWithServices(<HomeScreen />, services);
    await screen.findByText('Saldo Real Disponible');
    expect(screen.queryByText(/copia de seguridad/i)).not.toBeInTheDocument();
  });

  it('se refresca solo cuando cambian los datos (Observer)', async () => {
    await services.accounts.create({ name: 'Nu', type: 'DIGITAL', initialBalance: '1000' });
    await renderWithServices(<HomeScreen />, services);
    expect(await screen.findAllByText('$ 1.000')).not.toHaveLength(0);
    const [a] = await services.accounts.list();
    await services.transactions.create({ type: 'EXPENSE', amount: '400', date: '2026-03-10', description: 'x', accountId: a!.id });
    expect((await screen.findAllByText('$ 600')).length).toBeGreaterThan(0);
  });
});

describe('Nueva cuenta, Agregar e Historial', () => {
  it('crear una cuenta la guarda en el teléfono y vuelve al inicio', async () => {
    await renderWithServices(<NewAccountScreen />, services);
    await userEvent.type(await screen.findByLabelText('Nombre de la cuenta'), 'Bancolombia');
    await userEvent.type(screen.getByLabelText('Saldo actual'), '2500000');
    await userEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith('/'));
    expect((await services.accounts.list())[0]).toMatchObject({ name: 'Bancolombia', initialBalance: { amount: '2500000' } });
  });

  it('Agregar sin cuentas pide crear una primero', async () => {
    await renderWithServices(<AddScreen />, services);
    expect(await screen.findByRole('link', { name: 'Crear mi primera cuenta' })).toHaveAttribute('href', '/cuentas/nueva');
  });

  it('registrar un gasto lo guarda y aparece en el historial', async () => {
    await services.accounts.create({ name: 'Nu', type: 'DIGITAL', initialBalance: '100000' });
    await renderWithServices(<AddScreen />, services);
    await userEvent.type(await screen.findByLabelText('Monto'), '25000');
    await userEvent.type(screen.getByLabelText('Descripción'), 'Almuerzo');
    await userEvent.click(screen.getByRole('radio', { name: 'Nu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith('/historial'));
    expect((await services.transactions.page({})).items[0]).toMatchObject({ description: 'Almuerzo', amount: { amount: '25000' } });
  });

  it('Historial lista por día, filtra por cuenta y elimina con confirmación', async () => {
    await services.accounts.create({ name: 'Nu', type: 'DIGITAL', initialBalance: '0' });
    await services.accounts.create({ name: 'Efectivo', type: 'CASH', initialBalance: '0' });
    const [nu, ef] = await services.accounts.list();
    await services.transactions.create({ type: 'EXPENSE', amount: '1000', date: '2026-03-10', description: 'Café', accountId: nu!.id });
    await services.transactions.create({ type: 'EXPENSE', amount: '2000', date: '2026-03-09', description: 'Bus', accountId: ef!.id });

    const { unmount } = await renderWithServices(<HistoryScreen />, services);
    expect(await screen.findByText('Café')).toBeInTheDocument();
    expect(screen.getByText('Bus')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Editar Café' })).toHaveAttribute('href', expect.stringContaining('/movimientos/editar'));
    unmount();

    search = `cuenta=${ef!.id}`;
    const second = await renderWithServices(<HistoryScreen />, services);
    expect(await screen.findByText('Bus')).toBeInTheDocument();
    expect(screen.queryByText('Café')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /eliminar bus/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Sí, eliminar' }));
    await vi.waitFor(async () => expect((await services.transactions.page({})).items.map((t) => t.description)).toEqual(['Café']));
    second.unmount();
  });
});

describe('Programados', () => {
  it('"Ya lo pagué" registra el gasto real y lo quita de los pendientes', async () => {
    await services.accounts.create({ name: 'Nu', type: 'DIGITAL', initialBalance: '1000000' });
    const [a] = await services.accounts.list();
    await services.scheduled.create({ description: 'Arriendo', amount: '400000', accountId: a!.id, frequency: 'ONCE', startDate: '2026-03-10' });
    await renderWithServices(<ScheduledPage />, services);
    await userEvent.click(await screen.findByRole('button', { name: /ya lo pagué: arriendo/i }));
    await vi.waitFor(async () => expect((await services.transactions.page({})).items).toHaveLength(1));
    expect(await screen.findByText(/sin pagos pendientes/i)).toBeInTheDocument();
    expect((await services.summary.projection('2026-03-31')).netWorth.amount).toBe('600000');
  });
});
