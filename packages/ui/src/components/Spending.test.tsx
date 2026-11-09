import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { formatMoneyCompact, formatMonthTitle, monthName } from '../lib/format';
import type { SpendingView } from '../lib/types';
import { SpendingBreakdown } from './SpendingBreakdown';
import { SpendingHomeCard } from './SpendingHomeCard';

const row = (over: Partial<SpendingView['rows'][number]> = {}): SpendingView['rows'][number] => ({
  key: 'mercado',
  label: 'Mercado',
  kind: 'category',
  amount: '820000',
  percent: 33,
  barPct: 100,
  previousMarkPct: 90,
  delta: '90000',
  isNew: false,
  ...over,
});

const view = (over: Partial<SpendingView> = {}): SpendingView => ({
  month: '2026-11',
  previousMonth: '2026-10',
  isCurrent: false,
  comparedUntilDay: null,
  oldestMonth: '2024-12',
  currentMonth: '2026-11',
  total: '2450000',
  previousTotal: '2300000',
  totalDelta: '150000',
  rows: [row()],
  ...over,
});

const hrefs = {
  monthHref: (m: string) => `/historial?vista=gasto&mes=${m}`,
  rowHref: (key: string) => `/historial?mes=2026-11&categoria=${key}`,
};

describe('formato', () => {
  it('muestra pesos sin espacio y meses en español', () => {
    expect(formatMoneyCompact('2450000')).toBe('$2.450.000');
    expect(formatMoneyCompact(80000n)).toBe('$80.000');
    expect(formatMoneyCompact('9007199254740993')).toBe('$9.007.199.254.740.993');
    expect(monthName('2026-11')).toBe('noviembre');
    expect(formatMonthTitle('2026-11')).toBe('Noviembre 2026');
  });
});

describe('SpendingBreakdown', () => {
  it('abre con el número: lo gastado en el mes y la comparación total', () => {
    render(<SpendingBreakdown view={view()} {...hrefs} />);
    expect(screen.getByText('Gastaste $2.450.000 en noviembre')).toBeInTheDocument();
    expect(screen.getByText('↑ $150.000 más que en octubre')).toBeInTheDocument();
  });

  it('en el mes en curso compara con el mismo día del mes anterior', () => {
    render(<SpendingBreakdown view={view({ isCurrent: true, comparedUntilDay: 8 })} {...hrefs} />);
    expect(screen.getByText('↑ $150.000 más que a este mismo día en octubre')).toBeInTheDocument();
  });

  it('dice "menos" e "Igual" sin usar rojo ni verde en el texto', () => {
    const { rerender } = render(<SpendingBreakdown view={view({ totalDelta: '-20000' })} {...hrefs} />);
    expect(screen.getByText('↓ $20.000 menos que en octubre')).toBeInTheDocument();
    rerender(<SpendingBreakdown view={view({ totalDelta: '0' })} {...hrefs} />);
    expect(screen.getByText('Igual que en octubre')).toBeInTheDocument();
  });

  it('sin gastos el mes anterior explica que no hay con qué comparar', () => {
    render(<SpendingBreakdown view={view({ previousTotal: null, totalDelta: null, rows: [row({ delta: null })] })} {...hrefs} />);
    expect(screen.getByText('No hay gastos de octubre con qué comparar.')).toBeInTheDocument();
  });

  it('cada fila es un enlace con una frase completa para lector de pantalla', () => {
    render(<SpendingBreakdown view={view()} {...hrefs} />);
    const link = screen.getByRole('link', { name: 'Mercado, $820.000, 33 % del gasto, $90.000 más que en octubre' });
    expect(link).toHaveAttribute('href', '/historial?mes=2026-11&categoria=mercado');
    // Lo visual (barra, marca) no se lee: está oculto a la tecnología de apoyo.
    expect(link.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('frases de fila: menos, igual y nueva', () => {
    render(
      <SpendingBreakdown
        view={view({
          rows: [
            row({ key: 'a', label: 'Ocio', delta: '-20000', amount: '100000', percent: 4 }),
            row({ key: 'b', label: 'Salud', delta: '0', amount: '50000', percent: 2 }),
            row({ key: 'c', label: 'Ropa', delta: '70000', isNew: true, amount: '70000', percent: 3, previousMarkPct: null }),
          ],
        })}
        {...hrefs}
      />,
    );
    expect(screen.getByRole('link', { name: 'Ocio, $100.000, 4 % del gasto, $20.000 menos que en octubre' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Salud, $50.000, 2 % del gasto, igual que en octubre' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ropa, $70.000, 3 % del gasto, nuevo este mes' })).toBeInTheDocument();
    expect(screen.getByText('Nuevo este mes')).toBeInTheDocument();
    expect(screen.getByText('Igual que en octubre')).toBeInTheDocument();
  });

  it('Sin categoría navega y Otras no es un enlace', () => {
    render(
      <SpendingBreakdown
        view={view({
          rows: [
            row(),
            row({ key: 'sin-categoria', label: 'Sin categoría', kind: 'uncategorized', amount: '10000', percent: 1 }),
            row({ key: '__otras__', label: 'Otras', kind: 'other', amount: '5000', percent: 1 }),
          ],
        })}
        {...hrefs}
      />,
    );
    expect(screen.getByRole('link', { name: /^Sin categoría,/ })).toHaveAttribute('href', '/historial?mes=2026-11&categoria=sin-categoria');
    expect(screen.queryByRole('link', { name: /^Otras,/ })).toBeNull();
    const list = screen.getByRole('list', { name: 'Gasto por categoría' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(within(list).getByText(/^Otras, \$5\.000/)).toBeInTheDocument();
  });

  it('aclara que no incluye traspasos entre cuentas', () => {
    render(<SpendingBreakdown view={view()} {...hrefs} />);
    expect(screen.getByText('No incluye traspasos entre tus cuentas.')).toBeInTheDocument();
  });

  it('navega entre meses con botones de enlace y el de la derecha se apaga en el mes actual', () => {
    const { rerender } = render(<SpendingBreakdown view={view({ month: '2026-10', previousMonth: '2026-09' })} {...hrefs} />);
    expect(screen.getByText('Octubre 2026')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mes anterior: septiembre 2026' })).toHaveAttribute('href', '/historial?vista=gasto&mes=2026-09');
    expect(screen.getByRole('link', { name: 'Mes siguiente: noviembre 2026' })).toHaveAttribute('href', '/historial?vista=gasto&mes=2026-11');

    rerender(<SpendingBreakdown view={view({ isCurrent: true })} {...hrefs} />);
    const next = screen.getByRole('link', { name: 'Mes siguiente' });
    expect(next).toHaveAttribute('aria-disabled', 'true');
    expect(next).not.toHaveAttribute('href');
  });

  it('el botón de la izquierda se apaga en el mes más antiguo permitido', () => {
    render(<SpendingBreakdown view={view({ month: '2024-12', previousMonth: '2024-11', isCurrent: false })} {...hrefs} />);
    const prev = screen.getByRole('link', { name: 'Mes anterior' });
    expect(prev).toHaveAttribute('aria-disabled', 'true');
    expect(prev).not.toHaveAttribute('href');
  });

  it('estado vacío con el mes en el mensaje', () => {
    render(<SpendingBreakdown view={view({ total: '0', previousTotal: null, totalDelta: null, rows: [] })} {...hrefs} />);
    expect(
      screen.getByText('Todavía no hay gastos en noviembre. Cuando registres uno, aquí verás en qué se va tu plata.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Gastaste/)).toBeNull();
    // Se puede seguir navegando entre meses.
    expect(screen.getByRole('link', { name: /Mes anterior/ })).toBeInTheDocument();
  });

  it('dibuja barras con ancho porcentual y la marca fina del mes anterior', () => {
    const { container } = render(<SpendingBreakdown view={view({ rows: [row({ barPct: 62.5, previousMarkPct: 40 })] })} {...hrefs} />);
    const fill = container.querySelector<HTMLElement>('[data-bar]')!;
    const mark = container.querySelector<HTMLElement>('[data-mark]')!;
    expect(fill.style.width).toBe('62.5%');
    expect(mark.style.left).toBe('40%');
  });
});

describe('SpendingHomeCard', () => {
  it('resume lo gastado este mes y enlaza al detalle', () => {
    render(<SpendingHomeCard total="2450000" href="/historial?vista=gasto" />);
    expect(screen.getByText('Este mes gastaste $2.450.000')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver en qué' })).toHaveAttribute('href', '/historial?vista=gasto');
  });
});
