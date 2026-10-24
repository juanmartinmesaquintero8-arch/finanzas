import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountCards, AddTransactionForm, HistoryList, NewAccountForm, ScheduledForm, ScheduledList, type Account, type ScheduledExpense, type Transaction } from '@finanzas/ui';
import { EditAccountContainer } from './EditAccountContainer';
import { EditTransactionContainer } from './EditTransactionContainer';
import { ScheduledContainer } from './ScheduledContainer';

const push = vi.fn();
const actions = vi.hoisted(() => ({
  updateTransactionAction: vi.fn(),
  updateAccountAction: vi.fn(),
  updateScheduledExpenseAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/app/actions', () => ({
  ...actions,
  createScheduledExpenseAction: vi.fn(),
  deleteScheduledExpenseAction: vi.fn(),
  settleScheduledExpenseAction: vi.fn(),
}));

const cop = (amount: string) => ({ amount, currency: 'COP' });
const accounts: Account[] = [
  { id: 'bc', name: 'Bancolombia', type: 'BANK', initialBalance: cop('2000000') },
  { id: 'nu', name: 'Nu', type: 'DIGITAL', initialBalance: cop('0') },
];
const expense: Transaction = {
  id: 't1',
  type: 'EXPENSE',
  amount: cop('45000'),
  date: '2026-03-05T15:30:00.000Z',
  description: 'Almuerzo',
  category: 'Comida',
  accountId: 'bc',
  fromAccountId: null,
  toAccountId: null,
};
const transfer: Transaction = {
  id: 't2',
  type: 'TRANSFER',
  amount: cop('100000'),
  date: '2026-03-06T00:00:00.000Z',
  description: 'Pasar a Nu',
  category: null,
  accountId: null,
  fromAccountId: 'bc',
  toAccountId: 'nu',
};
const rent: ScheduledExpense = {
  id: 's1',
  description: 'Arriendo',
  amount: cop('1200000'),
  accountId: 'bc',
  frequency: 'MONTHLY',
  startDate: '2026-01-05',
  endDate: '2026-12-05',
  settledThrough: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AddTransactionForm precargado (editar movimiento)', () => {
  it('muestra los datos del gasto y el botón "Guardar cambios"', () => {
    render(<AddTransactionForm accounts={accounts} today="2026-03-10" transaction={expense} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('radio', { name: 'Gasto' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Monto')).toHaveValue('45.000');
    expect(screen.getByLabelText('Descripción')).toHaveValue('Almuerzo');
    expect(screen.getByLabelText('Categoría (opcional)')).toHaveValue('Comida');
    expect(screen.getByLabelText('Fecha')).toHaveValue('2026-03-05');
    expect(within(screen.getByRole('radiogroup', { name: 'Cuenta' })).getByRole('radio', { name: 'Bancolombia' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
  });

  it('precarga una transferencia con origen y destino', () => {
    render(<AddTransactionForm accounts={accounts} today="2026-03-10" transaction={transfer} onSubmit={vi.fn()} />);
    expect(screen.getByRole('radio', { name: 'Transferencia' })).toHaveAttribute('aria-checked', 'true');
    expect(within(screen.getByRole('radiogroup', { name: 'Desde' })).getByRole('radio', { name: 'Bancolombia' })).toHaveAttribute('aria-checked', 'true');
    expect(within(screen.getByRole('radiogroup', { name: 'Hacia' })).getByRole('radio', { name: 'Nu' })).toHaveAttribute('aria-checked', 'true');
  });

  it('envía los cambios (monto nuevo) conservando la hora original si la fecha no cambia', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    const onDone = vi.fn();
    render(<AddTransactionForm accounts={accounts} today="2026-03-10" transaction={expense} onSubmit={onSubmit} onDone={onDone} />);
    const amount = screen.getByLabelText('Monto');
    await userEvent.clear(amount);
    await userEvent.type(amount, '50000');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(onSubmit).toHaveBeenCalledWith({
      type: 'EXPENSE',
      amount: '50000',
      date: '2026-03-05T15:30:00.000Z',
      description: 'Almuerzo',
      category: 'Comida',
      accountId: 'bc',
    });
    expect(onDone).toHaveBeenCalled();
  });

  it('envía solo el día si el usuario cambia la fecha', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    render(<AddTransactionForm accounts={accounts} today="2026-03-10" transaction={expense} onSubmit={onSubmit} />);
    const date = screen.getByLabelText('Fecha');
    await userEvent.clear(date);
    await userEvent.type(date, '2026-03-08');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-03-08' }));
  });

  it('permite cambiar el tipo a ingreso y elegir otra cuenta', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    render(<AddTransactionForm accounts={accounts} today="2026-03-10" transaction={expense} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Ingreso' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Nu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ type: 'INCOME', accountId: 'nu' }));
  });

  it('Cancelar no guarda y avisa', async () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    render(<AddTransactionForm accounts={accounts} today="2026-03-10" transaction={expense} onSubmit={onSubmit} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('en modo crear no hay botón Cancelar ni "Guardar cambios"', () => {
    render(<AddTransactionForm accounts={accounts} today="2026-03-10" onSubmit={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeInTheDocument();
  });
});

describe('EditTransactionContainer (flujo de guardar)', () => {
  it('guarda con la Server Action y vuelve al historial', async () => {
    actions.updateTransactionAction.mockResolvedValue({ ok: true });
    render(<EditTransactionContainer transaction={expense} accounts={accounts} today="2026-03-10" />);
    const desc = screen.getByLabelText('Descripción');
    await userEvent.clear(desc);
    await userEvent.type(desc, 'Cena');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(actions.updateTransactionAction).toHaveBeenCalledWith('t1', expect.objectContaining({ description: 'Cena', amount: '45000' }));
    expect(push).toHaveBeenCalledWith('/historial');
  });

  it('si falla muestra el error y no navega', async () => {
    actions.updateTransactionAction.mockResolvedValue({ ok: false, error: 'No existe la cuenta' });
    render(<EditTransactionContainer transaction={expense} accounts={accounts} today="2026-03-10" />);
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No existe la cuenta');
    expect(push).not.toHaveBeenCalled();
  });

  it('Cancelar vuelve al historial sin guardar', async () => {
    render(<EditTransactionContainer transaction={expense} accounts={accounts} today="2026-03-10" />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(push).toHaveBeenCalledWith('/historial');
    expect(actions.updateTransactionAction).not.toHaveBeenCalled();
  });
});

describe('Cuenta: formulario precargado', () => {
  it('muestra nombre, tipo y saldo y envía los cambios', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    render(<NewAccountForm account={accounts[0]} onSubmit={onSubmit} onCancel={vi.fn()} />);
    expect(screen.getByLabelText('Nombre de la cuenta')).toHaveValue('Bancolombia');
    expect(screen.getByRole('radio', { name: 'Banco' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText(/Saldo/)).toHaveValue('2.000.000');
    const name = screen.getByLabelText('Nombre de la cuenta');
    await userEvent.clear(name);
    await userEvent.type(name, 'Bancolombia Ahorros');
    await userEvent.click(screen.getByRole('radio', { name: 'Ahorros' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Bancolombia Ahorros', type: 'SAVINGS', initialBalance: '2000000' });
  });

  it('EditAccountContainer guarda con la acción y vuelve al inicio', async () => {
    actions.updateAccountAction.mockResolvedValue({ ok: true });
    render(<EditAccountContainer account={accounts[1]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(actions.updateAccountAction).toHaveBeenCalledWith('nu', { name: 'Nu', type: 'DIGITAL', initialBalance: '0' });
    expect(push).toHaveBeenCalledWith('/');
  });

  it('las tarjetas de cuenta tienen opción "Editar"', () => {
    render(
      <AccountCards
        accounts={[{ accountId: 'bc', name: 'Bancolombia', balance: cop('1'), committed: cop('0'), available: cop('1') }]}
      />,
    );
    expect(screen.getByRole('link', { name: /editar.*bancolombia/i })).toHaveAttribute('href', '/cuentas/bc/editar');
  });
});

describe('Gasto programado: formulario precargado', () => {
  it('muestra los datos y envía los cambios incluyendo la fecha de fin', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    render(<ScheduledForm accounts={accounts} today="2026-03-10" expense={rent} onSubmit={onSubmit} onCancel={vi.fn()} />);
    expect(screen.getByLabelText('Descripción')).toHaveValue('Arriendo');
    expect(screen.getByLabelText('Monto')).toHaveValue('1.200.000');
    expect(screen.getByRole('radio', { name: 'Cada mes' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Fecha del primer pago')).toHaveValue('2026-01-05');
    expect(screen.getByLabelText(/último pago/i)).toHaveValue('2026-12-05');
    const amount = screen.getByLabelText('Monto');
    await userEvent.clear(amount);
    await userEvent.type(amount, '1300000');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(onSubmit).toHaveBeenCalledWith({
      description: 'Arriendo',
      amount: '1300000',
      accountId: 'bc',
      frequency: 'MONTHLY',
      startDate: '2026-01-05',
      endDate: '2026-12-05',
    });
  });

  it('la lista ofrece "Editar" y avisa con el gasto elegido', async () => {
    const onEdit = vi.fn();
    render(<ScheduledList items={[rent]} accounts={accounts} today="2026-03-10" onSettle={vi.fn()} onDelete={vi.fn()} onEdit={onEdit} />);
    await userEvent.click(screen.getByRole('button', { name: /editar.*arriendo/i }));
    expect(onEdit).toHaveBeenCalledWith(rent);
  });

  it('ScheduledContainer: Editar abre el formulario precargado y Guardar cambios llama a la acción', async () => {
    actions.updateScheduledExpenseAction.mockResolvedValue({ ok: true });
    render(<ScheduledContainer items={[rent]} accounts={accounts} today="2026-03-10" />);
    await userEvent.click(screen.getByRole('button', { name: /editar.*arriendo/i }));
    expect(await screen.findByLabelText('Descripción')).toHaveValue('Arriendo');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(actions.updateScheduledExpenseAction).toHaveBeenCalledWith('s1', expect.objectContaining({ description: 'Arriendo', amount: '1200000' }));
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument();
  });

  it('ScheduledContainer: Cancelar cierra la edición', async () => {
    render(<ScheduledContainer items={[rent]} accounts={accounts} today="2026-03-10" />);
    await userEvent.click(screen.getByRole('button', { name: /editar.*arriendo/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument();
  });
});

describe('Historial: tocar un movimiento abre la edición', () => {
  it('cada movimiento enlaza a /movimientos/:id/editar', () => {
    render(<HistoryList items={[expense, transfer]} accounts={accounts} onDelete={vi.fn()} now={new Date('2026-03-10T12:00:00Z')} />);
    expect(screen.getByRole('link', { name: /editar almuerzo/i })).toHaveAttribute('href', '/movimientos/t1/editar');
    expect(screen.getByRole('link', { name: /editar pasar a nu/i })).toHaveAttribute('href', '/movimientos/t2/editar');
  });
});
