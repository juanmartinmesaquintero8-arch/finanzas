import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AddTransactionForm } from './AddTransactionForm';
import { AvailableBalanceCard } from './AvailableBalanceCard';
import { HistoryList } from './HistoryList';
import { HistoryView } from './HistoryView';
import { TransactionTypeChips } from './TransactionTypeChips';
import type { Account, Transaction } from '@/lib/types';

const cop = (amount: string) => ({ amount, currency: 'COP' });

const accounts: Account[] = [
  { id: 'ef', name: 'Efectivo', type: 'CASH', initialBalance: cop('0') },
  { id: 'bc', name: 'Bancolombia', type: 'BANK', initialBalance: cop('0') },
  { id: 'nu', name: 'Nu', type: 'DIGITAL', initialBalance: cop('0') },
];

const tx = (over: Partial<Transaction>): Transaction => ({
  id: 't',
  type: 'EXPENSE',
  amount: cop('25000'),
  date: '2026-03-10T00:00:00.000Z',
  description: 'Mercado',
  category: 'Comida',
  accountId: 'ef',
  fromAccountId: null,
  toAccountId: null,
  ...over,
});

describe('AvailableBalanceCard', () => {
  const projection = { availableBalance: cop('3500000'), netWorth: cop('4000000'), committed: cop('500000'), isShortfall: false };

  it('muestra Saldo Real Disponible, patrimonio y comprometido con formato COP', () => {
    render(<AvailableBalanceCard projection={projection} horizon="month" />);
    expect(screen.getByText('Saldo Real Disponible')).toBeInTheDocument();
    expect(screen.getByText('$ 3.500.000')).toBeInTheDocument();
    expect(screen.getByText('$ 4.000.000')).toBeInTheDocument();
    expect(screen.getByText('$ 500.000')).toBeInTheDocument();
    expect(screen.getByText('Patrimonio total')).toBeInTheDocument();
    expect(screen.getByText('Comprometido')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('chips de horizonte con el activo marcado', () => {
    render(<AvailableBalanceCard projection={projection} horizon="30d" />);
    const group = screen.getByRole('group', { name: /horizonte/i });
    expect(within(group).getByRole('link', { name: '30 días' })).toHaveAttribute('aria-current', 'true');
    expect(within(group).getByRole('link', { name: 'Fin de mes' })).not.toHaveAttribute('aria-current');
    expect(within(group).getByRole('link', { name: '3 meses' })).toHaveAttribute('href', '/?h=3m');
  });

  it('muestra alerta cuando hay déficit', () => {
    render(<AvailableBalanceCard projection={{ ...projection, availableBalance: cop('-200000'), isShortfall: true }} horizon="month" />);
    expect(screen.getByRole('alert')).toHaveTextContent(/no te alcanza/i);
    expect(screen.getByText('-$ 200.000')).toBeInTheDocument();
  });
});

describe('TransactionTypeChips', () => {
  it('muestra Ingreso, Gasto y Transferencia y notifica el cambio', async () => {
    const onChange = vi.fn();
    render(<TransactionTypeChips value="EXPENSE" onChange={onChange} />);
    expect(screen.getByRole('radio', { name: 'Gasto' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Ingreso' })).not.toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: 'Transferencia' }));
    expect(onChange).toHaveBeenCalledWith('TRANSFER');
  });
});

describe('HistoryList', () => {
  const names = new Map(accounts.map((a) => [a.id, a.name]));
  const now = new Date('2026-03-10T15:00:00Z');
  const items = [
    tx({ id: '1', type: 'INCOME', description: 'Salario', category: 'Trabajo', amount: cop('3000000'), accountId: 'bc' }),
    tx({ id: '2', type: 'TRANSFER', description: 'Pasar a Nu', category: null, accountId: null, fromAccountId: 'bc', toAccountId: 'nu', amount: cop('100000') }),
    tx({ id: '3', date: '2026-03-09T00:00:00.000Z', description: 'Mercado' }),
  ];

  it('agrupa por día con encabezados Hoy/Ayer y distingue tipos', () => {
    render(<HistoryList items={items} accounts={accounts} now={now} onDelete={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Hoy' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ayer' })).toBeInTheDocument();
    expect(screen.getByText('+$ 3.000.000')).toBeInTheDocument();
    expect(screen.getByText('-$ 25.000')).toBeInTheDocument();
    expect(screen.getByText('Bancolombia → Nu')).toBeInTheDocument();
    expect(screen.getByText('$ 100.000')).toBeInTheDocument();
    expect(screen.getByText('Trabajo')).toBeInTheDocument();
  });

  it('pide confirmación en la propia UI antes de eliminar', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<HistoryList items={[items[2]!]} accounts={accounts} now={now} onDelete={onDelete} />);
    await userEvent.click(screen.getByRole('button', { name: /eliminar mercado/i }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText(/¿eliminar este movimiento\?/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByText(/¿eliminar este movimiento\?/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /eliminar mercado/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Sí, eliminar' }));
    expect(onDelete).toHaveBeenCalledWith('3');
  });

  it('estado vacío', () => {
    render(<HistoryList items={[]} accounts={accounts} now={now} onDelete={vi.fn()} />);
    expect(screen.getByText(/todavía no hay movimientos/i)).toBeInTheDocument();
  });
});

describe('HistoryView', () => {
  it('"Cargar más" usa nextCursor (no offset), añade resultados y se oculta al terminar', async () => {
    const loadPage = vi.fn().mockResolvedValue({ items: [tx({ id: '9', description: 'Taxi' })], nextCursor: null });
    render(
      <HistoryView
        initialPage={{ items: [tx({ id: '1', description: 'Mercado' })], nextCursor: 'cursor-1' }}
        accounts={accounts}
        accountId="ef"
        loadPage={loadPage}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('Mercado')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cargar más' }));
    expect(loadPage).toHaveBeenCalledWith({ accountId: 'ef', cursor: 'cursor-1' });
    expect(await screen.findByText('Taxi')).toBeInTheDocument();
    expect(screen.getByText('Mercado')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cargar más' })).not.toBeInTheDocument();
  });

  it('sin nextCursor no hay botón', () => {
    render(<HistoryView initialPage={{ items: [tx({})], nextCursor: null }} accounts={accounts} loadPage={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Cargar más' })).not.toBeInTheDocument();
  });

  it('muestra el error si falla la carga', async () => {
    const loadPage = vi.fn().mockRejectedValue(new Error('x'));
    render(<HistoryView initialPage={{ items: [tx({})], nextCursor: 'c' }} accounts={accounts} loadPage={loadPage} onDelete={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cargar más' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/no pudimos cargar/i);
  });
});

describe('AddTransactionForm', () => {
  it('formatea el monto en vivo y usa teclado numérico', async () => {
    render(<AddTransactionForm accounts={accounts} today="2026-03-10" onSubmit={vi.fn()} />);
    const amount = screen.getByLabelText('Monto');
    expect(amount).toHaveAttribute('inputmode', 'numeric');
    await userEvent.type(amount, '1234567');
    expect(amount).toHaveValue('1.234.567');
  });

  it('valida en español y no envía si hay errores', async () => {
    const onSubmit = vi.fn();
    render(<AddTransactionForm accounts={accounts} today="2026-03-10" onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(screen.getByText('Escribe un monto mayor a cero.')).toBeInTheDocument();
    expect(screen.getByText('Escribe una descripción.')).toBeInTheDocument();
    expect(screen.getByText('Elige una cuenta.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('envía un gasto válido con fecha de hoy por defecto', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    render(<AddTransactionForm accounts={accounts} today="2026-03-10" onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText('Monto'), '50000');
    await userEvent.type(screen.getByLabelText('Descripción'), 'Almuerzo');
    await userEvent.click(screen.getByRole('radio', { name: 'Nu' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Comida' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(onSubmit).toHaveBeenCalledWith({
      type: 'EXPENSE',
      amount: '50000',
      date: '2026-03-10',
      description: 'Almuerzo',
      category: 'Comida',
      accountId: 'nu',
    });
  });

  it('transferencia pide origen y destino', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    render(<AddTransactionForm accounts={accounts} today="2026-03-10" onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Transferencia' }));
    expect(screen.getByRole('radiogroup', { name: 'Desde' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Hacia' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Monto'), '100000');
    await userEvent.type(screen.getByLabelText('Descripción'), 'Pasar a Nu');
    await userEvent.click(within(screen.getByRole('radiogroup', { name: 'Desde' })).getByRole('radio', { name: 'Bancolombia' }));
    await userEvent.click(within(screen.getByRole('radiogroup', { name: 'Hacia' })).getByRole('radio', { name: 'Nu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ type: 'TRANSFER', fromAccountId: 'bc', toAccountId: 'nu', amount: '100000' }));
  });

  it('muestra el error que devuelve el servidor', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: false, error: 'Saldo insuficiente' });
    render(<AddTransactionForm accounts={accounts} today="2026-03-10" onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText('Monto'), '5');
    await userEvent.type(screen.getByLabelText('Descripción'), 'x');
    await userEvent.click(screen.getByRole('radio', { name: 'Efectivo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Saldo insuficiente');
  });
});
