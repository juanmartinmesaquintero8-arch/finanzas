import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppServices } from '@/application/create-services';
import { makeServices, renderWithServices } from '@/test-utils';
import { HistoryScreen } from './HistoryScreen';
import { HomeScreen } from './HomeScreen';

let search = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/historial',
  useSearchParams: () => new URLSearchParams(search),
}));

let services: AppServices;
let accountId = '';

beforeEach(async () => {
  search = '';
  services = await makeServices(); // 10 de marzo de 2026
  await services.accounts.create({ name: 'Banco', type: 'BANK', initialBalance: '1000000' });
  accountId = (await services.accounts.list())[0]!.id;
});

const spend = async (date: string, amount: string, category: string | undefined, description = 'Compra') => {
  const res = await services.transactions.create({ type: 'EXPENSE', amount, date, description, category, accountId });
  expect(res).toEqual({ ok: true });
};

describe('Historial: selector de vistas', () => {
  it('abre en Movimientos y ofrece "En qué gasto"', async () => {
    await spend('2026-03-02', '1000', 'Mercado');
    await renderWithServices(<HistoryScreen />, services);
    const group = await screen.findByRole('group', { name: 'Vista' });
    expect(within(group).getByRole('link', { name: 'Movimientos' })).toHaveAttribute('aria-current', 'true');
    expect(within(group).getByRole('link', { name: 'En qué gasto' })).toHaveAttribute('href', '/historial?vista=gasto');
  });

  it('comparten el mes: si la dirección trae el mes, los dos enlaces lo conservan', async () => {
    search = 'vista=gasto&mes=2026-02';
    await renderWithServices(<HistoryScreen />, services);
    const group = await screen.findByRole('group', { name: 'Vista' });
    expect(within(group).getByRole('link', { name: 'En qué gasto' })).toHaveAttribute('aria-current', 'true');
    expect(within(group).getByRole('link', { name: 'Movimientos' })).toHaveAttribute('href', '/historial?mes=2026-02');
  });
});

describe('En qué gasto', () => {
  it('muestra el número, la comparación y las filas, con el mes actual por defecto', async () => {
    await spend('2026-02-05', '100000', 'Mercado');
    await spend('2026-03-02', '180000', 'Mercado');
    await spend('2026-03-03', '20000', 'Ocio');
    search = 'vista=gasto';
    await renderWithServices(<HistoryScreen />, services);

    expect(await screen.findByText('Gastaste $200.000 en marzo')).toBeInTheDocument();
    expect(screen.getByText('↑ $100.000 más que a este mismo día en febrero')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mercado, $180.000, 90 % del gasto, $80.000 más que a este mismo día en febrero' })).toHaveAttribute(
      'href',
      '/historial?mes=2026-03&categoria=mercado',
    );
    expect(screen.getByRole('link', { name: /^Ocio,.*nuevo este mes$/ })).toBeInTheDocument();
    expect(screen.getByText('No incluye traspasos entre tus cuentas.')).toBeInTheDocument();
  });

  it('cambia de mes con la dirección (?mes=) y el botón derecho se apaga en el mes actual', async () => {
    await spend('2026-02-05', '70000', 'Mercado');
    search = 'vista=gasto&mes=2026-02';
    const { unmount } = await renderWithServices(<HistoryScreen />, services);
    expect(await screen.findByText('Gastaste $70.000 en febrero')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mes anterior: enero 2026' })).toHaveAttribute('href', '/historial?vista=gasto&mes=2026-01');
    expect(screen.getByRole('link', { name: 'Mes siguiente: marzo 2026' })).toHaveAttribute('href', '/historial?vista=gasto&mes=2026-03');
    unmount();

    search = 'vista=gasto&mes=2026-03';
    await renderWithServices(<HistoryScreen />, services);
    expect(await screen.findByRole('heading', { name: 'Marzo 2026' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mes siguiente' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('un mes inválido o fuera de la ventana de 24 meses cae en uno permitido', async () => {
    search = 'vista=gasto&mes=1999-01';
    await renderWithServices(<HistoryScreen />, services);
    expect(await screen.findByRole('heading', { name: 'Abril 2024' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mes anterior' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('sin gastos en el mes muestra el mensaje de vacío', async () => {
    search = 'vista=gasto';
    await renderWithServices(<HistoryScreen />, services);
    expect(
      await screen.findByText('Todavía no hay gastos en marzo. Cuando registres uno, aquí verás en qué se va tu plata.'),
    ).toBeInTheDocument();
  });

  it('se actualiza solo al registrar un gasto nuevo', async () => {
    search = 'vista=gasto';
    await renderWithServices(<HistoryScreen />, services);
    await screen.findByText(/Todavía no hay gastos en marzo/);
    await spend('2026-03-04', '12000', 'Café');
    expect(await screen.findByText('Gastaste $12.000 en marzo')).toBeInTheDocument();
  });
});

describe('Historial filtrado desde una fila', () => {
  beforeEach(async () => {
    await spend('2026-02-05', '1000', 'Mercado', 'Mercado grande');
    await spend('2026-02-06', '2000', 'Ocio', 'Cine');
    await spend('2026-02-07', '3000', undefined, 'Sin clasificar');
    await spend('2026-03-01', '4000', 'Mercado', 'Mercado de marzo');
  });

  it('lista solo esa categoría y ese mes, con formas visibles de quitar cada filtro', async () => {
    search = 'mes=2026-02&categoria=mercado';
    await renderWithServices(<HistoryScreen />, services);
    expect(await screen.findByText('Mercado grande')).toBeInTheDocument();
    expect(screen.queryByText('Cine')).toBeNull();
    expect(screen.queryByText('Mercado de marzo')).toBeNull();

    expect(screen.getByRole('link', { name: 'Quitar filtro de categoría: Mercado' })).toHaveAttribute('href', '/historial?mes=2026-02');
    expect(screen.getByRole('link', { name: 'Quitar filtro de mes: Febrero 2026' })).toHaveAttribute('href', '/historial');
    expect(screen.getByRole('link', { name: 'Movimientos' })).toHaveAttribute('aria-current', 'true');
  });

  it('Sin categoría también se puede abrir', async () => {
    search = 'mes=2026-02&categoria=sin-categoria';
    await renderWithServices(<HistoryScreen />, services);
    expect(await screen.findByText('Sin clasificar')).toBeInTheDocument();
    expect(screen.queryByText('Mercado grande')).toBeNull();
    expect(screen.getByRole('link', { name: 'Quitar filtro de categoría: Sin categoría' })).toBeInTheDocument();
  });

  it('solo con el mes lista todos los movimientos de ese mes', async () => {
    search = 'mes=2026-02';
    await renderWithServices(<HistoryScreen />, services);
    expect(await screen.findByText('Mercado grande')).toBeInTheDocument();
    expect(screen.getByText('Cine')).toBeInTheDocument();
    expect(screen.queryByText('Mercado de marzo')).toBeNull();
  });
});

describe('Inicio: tarjeta de gasto del mes', () => {
  it('muestra cuánto se gastó este mes y enlaza al detalle', async () => {
    await spend('2026-03-02', '45000', 'Mercado');
    await spend('2026-02-02', '999000', 'Mercado');
    await renderWithServices(<HomeScreen />, services);
    expect(await screen.findByText('Este mes gastaste $45.000')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver en qué' })).toHaveAttribute('href', '/historial?vista=gasto');
  });

  it('sin gastos este mes no se muestra', async () => {
    await spend('2026-02-02', '999000', 'Mercado');
    await renderWithServices(<HomeScreen />, services);
    await screen.findByText('Saldo Real Disponible');
    expect(screen.queryByText(/Este mes gastaste/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Ver en qué' })).toBeNull();
  });
});

describe('correcciones de la ronda 1', () => {
  it('?categoria= escrita a mano, sin mes, no filtra y no muestra filtros', async () => {
    await spend('2026-02-05', '1000', 'Mercado', 'Mercado grande');
    await spend('2026-02-06', '2000', 'Ocio', 'Cine');
    search = 'categoria=ocio';
    await renderWithServices(<HistoryScreen />, services);
    expect(await screen.findByText('Mercado grande')).toBeInTheDocument();
    expect(screen.getByText('Cine')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Quitar filtro/ })).toBeNull();
  });

  it('el mes en curso filtrado desde una fila no lista gastos futuros', async () => {
    await spend('2026-03-09', '1000', 'Mercado', 'Ya pasó');
    await spend('2026-03-25', '2000', 'Mercado', 'Futuro');
    search = 'mes=2026-03&categoria=mercado';
    await renderWithServices(<HistoryScreen />, services);
    expect(await screen.findByText('Ya pasó')).toBeInTheDocument();
    expect(screen.queryByText('Futuro')).toBeNull();
  });

  it('una lista filtrada vacía no enseña la clave cruda', async () => {
    search = 'mes=2026-02&categoria=educacion';
    await renderWithServices(<HistoryScreen />, services);
    expect(await screen.findByRole('link', { name: 'Quitar filtro de categoría: Categoría' })).toBeInTheDocument();
    expect(screen.queryByText('educacion')).toBeNull();
  });
});
