import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AccountCards } from './AccountCards';
import { NewAccountForm } from './NewAccountForm';
import { ScheduledList } from './ScheduledList';
import { ScheduledForm } from './ScheduledForm';
import type { Account, ScheduledExpense } from '../lib/types';

const cop = (amount: string) => ({ amount, currency: 'COP' });
const accounts: Account[] = [
  { id: 'bc', name: 'Bancolombia', type: 'BANK', initialBalance: cop('0') },
  { id: 'nu', name: 'Nu', type: 'DIGITAL', initialBalance: cop('0') },
];
const rent: ScheduledExpense = {
  id: 's1',
  description: 'Arriendo',
  amount: cop('1200000'),
  accountId: 'bc',
  frequency: 'MONTHLY',
  startDate: '2026-01-05',
  endDate: null,
  settledThrough: null,
};

describe('AccountCards', () => {
  it('muestra saldo y disponible por cuenta', () => {
    render(
      <AccountCards
        accounts={[
          { accountId: 'bc', name: 'Bancolombia', balance: cop('3000000'), committed: cop('1200000'), available: cop('1800000') },
        ]}
      />,
    );
    expect(screen.getByText('Bancolombia')).toBeInTheDocument();
    expect(screen.getByText('$ 3.000.000')).toBeInTheDocument();
    expect(screen.getByText('$ 1.800.000')).toBeInTheDocument();
  });
});

describe('ScheduledList', () => {
  const props = { accounts, today: '2026-03-10', onSettle: vi.fn(), onDelete: vi.fn() };

  it('muestra frecuencia legible, próximo pago, monto y cuenta', () => {
    render(<ScheduledList items={[rent]} {...props} />);
    expect(screen.getByText('Arriendo')).toBeInTheDocument();
    expect(screen.getByText('Cada mes, día 5')).toBeInTheDocument();
    expect(screen.getByText(/Próximo pago: 5 abr 2026/)).toBeInTheDocument();
    expect(screen.getByText('$ 1.200.000')).toBeInTheDocument();
    expect(screen.getByText('Bancolombia')).toBeInTheDocument();
  });

  it('"Ya lo pagué" liquida hasta hoy', async () => {
    const onSettle = vi.fn().mockResolvedValue(undefined);
    render(<ScheduledList items={[rent]} {...props} onSettle={onSettle} />);
    await userEvent.click(screen.getByRole('button', { name: /ya lo pagué.*arriendo/i }));
    expect(onSettle).toHaveBeenCalledWith('s1', '2026-03-10');
  });

  it('elimina con confirmación', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<ScheduledList items={[rent]} {...props} onDelete={onDelete} />);
    await userEvent.click(screen.getByRole('button', { name: /eliminar arriendo/i }));
    expect(onDelete).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Sí, eliminar' }));
    expect(onDelete).toHaveBeenCalledWith('s1');
  });

  it('estado vacío', () => {
    render(<ScheduledList items={[]} {...props} />);
    expect(screen.getByText(/no tienes gastos programados/i)).toBeInTheDocument();
  });
});

describe('ScheduledForm', () => {
  it('valida y envía', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    render(<ScheduledForm accounts={accounts} today="2026-03-10" onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(screen.getByText('Escribe qué vas a pagar.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText('Descripción'), 'Internet');
    await userEvent.type(screen.getByLabelText('Monto'), '90000');
    await userEvent.click(screen.getByRole('radio', { name: 'Nu' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Cada mes' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(onSubmit).toHaveBeenCalledWith({
      description: 'Internet',
      amount: '90000',
      accountId: 'nu',
      frequency: 'MONTHLY',
      startDate: '2026-03-10',
    });
  });
});

describe('NewAccountForm', () => {
  it('exige nombre y envía saldo inicial como entero', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    render(<NewAccountForm onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(screen.getByText('Escribe un nombre para la cuenta.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Nombre de la cuenta'), 'Nu');
    await userEvent.click(screen.getByRole('radio', { name: 'Digital' }));
    await userEvent.type(screen.getByLabelText('Saldo actual'), '800000');
    await userEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Nu', type: 'DIGITAL', initialBalance: '800000' });
  });
});
