import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AccountFilterChips } from './AccountFilterChips';
import { ScheduledScreen } from './ScheduledScreen';
import type { Account, ScheduledExpense } from '../lib/types';

const cop = (amount: string) => ({ amount, currency: 'COP' });
const accounts: Account[] = [
  { id: 'ef', name: 'Efectivo', type: 'CASH', initialBalance: cop('0') },
  { id: 'bc', name: 'Bancolombia', type: 'BANK', initialBalance: cop('0') },
];

describe('AccountFilterChips', () => {
  it('marca "Todas" cuando no hay cuenta elegida y usa los enlaces por defecto', () => {
    render(<AccountFilterChips accounts={accounts} />);
    expect(screen.getByRole('link', { name: 'Todas' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('link', { name: 'Todas' })).toHaveAttribute('href', '/historial');
    expect(screen.getByRole('link', { name: 'Efectivo' })).toHaveAttribute('href', '/historial?cuenta=ef');
  });

  it('marca la cuenta elegida y acepta enlaces propios', () => {
    render(<AccountFilterChips accounts={accounts} selectedId="bc" hrefFor={(id) => (id ? `/h?cuenta=${id}` : '/h')} />);
    expect(screen.getByRole('link', { name: 'Bancolombia' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('link', { name: 'Todas' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Todas' })).toHaveAttribute('href', '/h');
    expect(screen.getByRole('link', { name: 'Efectivo' })).toHaveAttribute('href', '/h?cuenta=ef');
  });
});

const rent: ScheduledExpense = {
  id: 's1',
  description: 'Arriendo',
  amount: cop('900000'),
  accountId: 'bc',
  frequency: 'MONTHLY',
  startDate: '2026-03-05',
  endDate: null,
  settledThrough: null,
};

describe('ScheduledScreen', () => {
  const handlers = () => ({
    onCreate: vi.fn().mockResolvedValue({ ok: true }),
    onUpdate: vi.fn().mockResolvedValue({ ok: true }),
    onSettle: vi.fn().mockResolvedValue({ ok: true }),
    onDelete: vi.fn().mockResolvedValue({ ok: true }),
  });

  it('crea un gasto programado con el callback recibido', async () => {
    const h = handlers();
    render(<ScheduledScreen items={[]} accounts={accounts} today="2026-03-10" {...h} />);
    await userEvent.click(screen.getByRole('button', { name: '+ Nuevo gasto programado' }));
    await userEvent.type(await screen.findByLabelText('Descripción'), 'Internet');
    await userEvent.type(screen.getByLabelText('Monto'), '80000');
    await userEvent.click(screen.getByRole('radio', { name: 'Efectivo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(h.onCreate).toHaveBeenCalledWith(expect.objectContaining({ description: 'Internet', amount: '80000', accountId: 'ef' }));
  });

  it('"Ya lo pagué" liquida hasta hoy y eliminar pide confirmación', async () => {
    const h = handlers();
    render(<ScheduledScreen items={[rent]} accounts={accounts} today="2026-03-10" {...h} />);
    await userEvent.click(screen.getByRole('button', { name: /ya lo pagué: arriendo/i }));
    expect(h.onSettle).toHaveBeenCalledWith('s1', '2026-03-10');
    await userEvent.click(screen.getByRole('button', { name: /eliminar arriendo/i }));
    expect(h.onDelete).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Sí, eliminar' }));
    expect(h.onDelete).toHaveBeenCalledWith('s1');
  });

  it('editar abre el formulario precargado y guarda con onUpdate', async () => {
    const h = handlers();
    render(<ScheduledScreen items={[rent]} accounts={accounts} today="2026-03-10" {...h} />);
    await userEvent.click(screen.getByRole('button', { name: /editar arriendo/i }));
    const description = await screen.findByLabelText('Descripción');
    expect(description).toHaveValue('Arriendo');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(h.onUpdate).toHaveBeenCalledWith('s1', expect.objectContaining({ description: 'Arriendo', amount: '900000' }));
  });
});
