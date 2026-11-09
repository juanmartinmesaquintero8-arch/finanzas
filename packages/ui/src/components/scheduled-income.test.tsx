import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { hasDueOccurrence } from '../lib/domain-helpers';
import { formatWeekdayDate } from '../lib/format';
import type { Account, ScheduledExpense } from '../lib/types';
import { validateScheduledForm } from '../lib/validation';
import { ExpectedIncomeNote } from './ExpectedIncomeNote';
import { ScheduledForm } from './ScheduledForm';
import { ScheduledKindSwitch } from './ScheduledKindSwitch';
import { ScheduledList } from './ScheduledList';
import { ScheduledScreen } from './ScheduledScreen';

const cop = (amount: string) => ({ amount, currency: 'COP' });
const accounts: Account[] = [
  { id: 'bc', name: 'Bancolombia', type: 'BANK', initialBalance: cop('0') },
  { id: 'nu', name: 'Nu', type: 'DIGITAL', initialBalance: cop('0') },
];
const salary: ScheduledExpense = {
  id: 'i1',
  description: 'Sueldo',
  amount: cop('3000000'),
  accountId: 'bc',
  frequency: 'MONTHLY',
  startDate: '2026-01-30',
  endDate: null,
  settledThrough: null,
  category: 'Salario',
};
const handlers = () => ({
  onCreate: vi.fn().mockResolvedValue({ ok: true }),
  onUpdate: vi.fn().mockResolvedValue({ ok: true }),
  onSettle: vi.fn().mockResolvedValue({ ok: true }),
  onDelete: vi.fn().mockResolvedValue({ ok: true }),
});

describe('hasDueOccurrence', () => {
  const base = { frequency: 'MONTHLY' as const, startDate: '2026-01-30', endDate: null, settledThrough: null };
  it('hay algo por recibir cuando ya llegó una fecha sin liquidar', () => {
    expect(hasDueOccurrence(base, '2026-03-10')).toBe(true);
    expect(hasDueOccurrence({ ...base, settledThrough: '2026-02-28' }, '2026-03-10')).toBe(false);
    expect(hasDueOccurrence({ ...base, settledThrough: '2026-03-10' }, '2026-03-10')).toBe(false);
  });
  it('no hay nada si la primera fecha aún no llega o ya pasó el fin', () => {
    expect(hasDueOccurrence({ ...base, startDate: '2026-03-30' }, '2026-03-10')).toBe(false);
    expect(hasDueOccurrence({ ...base, frequency: 'ONCE', startDate: '2026-03-10' }, '2026-03-10')).toBe(true);
    expect(hasDueOccurrence({ ...base, frequency: 'ONCE', startDate: '2026-03-10', settledThrough: '2026-03-10' }, '2026-03-10')).toBe(false);
    expect(hasDueOccurrence({ ...base, endDate: '2026-02-01', settledThrough: '2026-01-30' }, '2026-03-10')).toBe(false);
  });
});

describe('formatWeekdayDate', () => {
  it('da el día de la semana, el número y el mes', () => {
    expect(formatWeekdayDate('2026-03-30')).toBe('lunes 30 de marzo');
  });
});

describe('validateScheduledForm: ingreso y categoría', () => {
  const values = { description: '', amountText: '', accountId: '', frequency: 'MONTHLY' as const, startDate: '', endDate: '' };
  it('con kind income usa los textos de ingreso', () => {
    const r = validateScheduledForm(values, 'income');
    expect(r).toEqual({
      ok: false,
      errors: {
        description: 'Escribe qué vas a recibir.',
        amount: 'Escribe un monto mayor a cero.',
        account: 'Elige a qué cuenta llega.',
        startDate: 'Elige la fecha del primer ingreso.',
      },
    });
    expect(validateScheduledForm({ ...values, description: 'x', amountText: '5', accountId: 'bc', startDate: '2026-03-10', endDate: '2026-03-01' }, 'income')).toEqual({
      ok: false,
      errors: { endDate: 'El último ingreso no puede ser antes del primero.' },
    });
  });
  it('los gastos conservan sus textos', () => {
    const r = validateScheduledForm(values);
    expect(r).toMatchObject({ ok: false, errors: { description: 'Escribe qué vas a pagar.', account: 'Elige de qué cuenta se paga.' } });
  });
  it('la categoría va recortada y solo si se escribió', () => {
    const ok = { ...values, description: 'Sueldo', amountText: '5', accountId: 'bc', startDate: '2026-03-10' };
    expect(validateScheduledForm({ ...ok, category: '  Salario ' }, 'income')).toMatchObject({ ok: true, value: { category: 'Salario' } });
    const noCat = validateScheduledForm({ ...ok, category: '  ' }, 'income');
    expect(noCat.ok && 'category' in noCat.value).toBe(false);
  });
});

describe('ScheduledForm en modo ingreso', () => {
  it('muestra los campos en el orden pedido y con los textos de ingreso', () => {
    render(<ScheduledForm kind="income" withCategory accounts={accounts} today="2026-03-10" onSubmit={vi.fn()} />);
    const labels = [...document.querySelectorAll('label, [role="radiogroup"]')].map((n) => (n.tagName === 'LABEL' ? n.textContent : n.getAttribute('aria-label')));
    expect(labels).toEqual([
      'Descripción',
      'Monto',
      'Se recibe en',
      'Frecuencia',
      'Fecha del primer ingreso',
      'Fecha del último ingreso (opcional)',
      'Categoría (opcional)',
    ]);
    expect(screen.getByLabelText('Descripción')).toHaveAttribute('placeholder', 'Ej: Sueldo');
  });

  it('valida con textos de ingreso y envía con la categoría', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    render(<ScheduledForm kind="income" withCategory accounts={accounts} today="2026-03-10" onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(screen.getByText('Escribe qué vas a recibir.')).toBeInTheDocument();
    expect(screen.getByText('Elige a qué cuenta llega.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Descripción'), 'Sueldo');
    await userEvent.type(screen.getByLabelText('Monto'), '3000000');
    await userEvent.click(screen.getByRole('radio', { name: 'Nu' }));
    await userEvent.type(screen.getByLabelText('Categoría (opcional)'), 'Salario');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(onSubmit).toHaveBeenCalledWith({
      description: 'Sueldo',
      amount: '3000000',
      accountId: 'nu',
      frequency: 'MONTHLY',
      startDate: '2026-03-10',
      category: 'Salario',
    });
  });

  it('el error de guardado habla del ingreso programado', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('x'));
    render(<ScheduledForm kind="income" accounts={accounts} today="2026-03-10" onSubmit={onSubmit} expense={salary} />);
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos guardar el ingreso programado. Intenta de nuevo.');
  });

  it('el gasto también ofrece categoría si se pide, y la web (sin pedirla) no la muestra', () => {
    const { unmount } = render(<ScheduledForm withCategory accounts={accounts} today="2026-03-10" onSubmit={vi.fn()} />);
    expect(screen.getByLabelText('Categoría (opcional)')).toBeInTheDocument();
    expect(screen.getByLabelText('Fecha del primer pago')).toBeInTheDocument();
    unmount();
    render(<ScheduledForm accounts={accounts} today="2026-03-10" onSubmit={vi.fn()} />);
    expect(screen.queryByLabelText('Categoría (opcional)')).not.toBeInTheDocument();
  });

  it('al editar precarga la categoría', () => {
    render(<ScheduledForm kind="income" withCategory expense={salary} accounts={accounts} today="2026-03-10" onSubmit={vi.fn()} />);
    expect(screen.getByLabelText('Categoría (opcional)')).toHaveValue('Salario');
  });
});

describe('ScheduledList en modo ingreso', () => {
  const props = { accounts, today: '2026-03-10', onSettle: vi.fn().mockResolvedValue(undefined), onDelete: vi.fn().mockResolvedValue(undefined), kind: 'income' as const };

  it('muestra el monto con + y el próximo ingreso', () => {
    render(<ScheduledList items={[{ ...salary, settledThrough: '2026-02-28' }]} {...props} />);
    expect(screen.getByText('+ $ 3.000.000')).toBeInTheDocument();
    expect(screen.getByText(/Próximo ingreso: 30 mar 2026/)).toBeInTheDocument();
    expect(screen.getByText('Cada mes, día 30')).toBeInTheDocument();
  });

  it('"Ya lo recibí" registra hasta hoy cuando ya llegó la fecha', async () => {
    const onSettle = vi.fn().mockResolvedValue(undefined);
    render(<ScheduledList items={[salary]} {...props} onSettle={onSettle} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ya lo recibí: Sueldo' }));
    expect(onSettle).toHaveBeenCalledWith('i1', '2026-03-10');
  });

  it('el botón queda apagado cuando aún no llega la fecha', () => {
    render(<ScheduledList items={[{ ...salary, settledThrough: '2026-02-28' }]} {...props} />);
    expect(screen.getByRole('button', { name: 'Ya lo recibí: Sueldo' })).toBeDisabled();
  });

  it('si falla, avisa con palabras de ingreso', async () => {
    render(<ScheduledList items={[salary]} {...props} onSettle={vi.fn().mockRejectedValue(new Error('x'))} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ya lo recibí: Sueldo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos registrar el ingreso. Intenta de nuevo.');
  });

  it('elimina con confirmación de ingreso', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<ScheduledList items={[salary]} {...props} onDelete={onDelete} />);
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar Sueldo' }));
    expect(screen.getByText('¿Eliminar este ingreso programado?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sí, eliminar' }));
    expect(onDelete).toHaveBeenCalledWith('i1');
  });

  it('estado vacío', () => {
    render(<ScheduledList items={[]} {...props} />);
    expect(screen.getByText('No tienes ingresos programados. Agrega tu sueldo o lo que recibes seguido.')).toBeInTheDocument();
  });

  it('los gastos siguen con su "-" implícito y su botón de siempre', () => {
    const rent: ScheduledExpense = { ...salary, id: 's1', description: 'Arriendo', amount: cop('1200000') };
    render(<ScheduledList items={[rent]} accounts={accounts} today="2026-03-10" onSettle={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('$ 1.200.000')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ya lo pagué: Arriendo' })).toBeEnabled();
  });
});

describe('ScheduledScreen en modo ingreso', () => {
  it('crea un ingreso con su botón y sus callbacks', async () => {
    const h = handlers();
    render(<ScheduledScreen kind="income" withCategory items={[]} accounts={accounts} today="2026-03-10" {...h} />);
    expect(screen.getByText('No tienes ingresos programados. Agrega tu sueldo o lo que recibes seguido.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '+ Nuevo ingreso programado' }));
    await userEvent.type(await screen.findByLabelText('Descripción'), 'Sueldo');
    await userEvent.type(screen.getByLabelText('Monto'), '3000000');
    await userEvent.click(screen.getByRole('radio', { name: 'Nu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(h.onCreate).toHaveBeenCalledWith(expect.objectContaining({ description: 'Sueldo', accountId: 'nu' }));
  });

  it('recibir y editar usan los callbacks recibidos', async () => {
    const h = handlers();
    render(<ScheduledScreen kind="income" withCategory items={[salary]} accounts={accounts} today="2026-03-10" {...h} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ya lo recibí: Sueldo' }));
    expect(h.onSettle).toHaveBeenCalledWith('i1', '2026-03-10');
    await userEvent.click(screen.getByRole('button', { name: 'Editar Sueldo' }));
    expect(await screen.findByLabelText('Categoría (opcional)')).toHaveValue('Salario');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(h.onUpdate).toHaveBeenCalledWith('i1', expect.objectContaining({ description: 'Sueldo', category: 'Salario' }));
  });

  it('sin kind sigue siendo la pantalla de gastos', () => {
    render(<ScheduledScreen items={[]} accounts={accounts} today="2026-03-10" {...handlers()} />);
    expect(screen.getByRole('button', { name: '+ Nuevo gasto programado' })).toBeInTheDocument();
  });
});

describe('ScheduledKindSwitch', () => {
  it('ofrece Gastos e Ingresos con enlaces y marca el activo', () => {
    render(<ScheduledKindSwitch active="incomes" expensesHref="/programados" incomesHref="/programados?tipo=ingresos" />);
    const group = screen.getByRole('group', { name: 'Tipo' });
    expect(within(group).getByRole('link', { name: 'Gastos' })).toHaveAttribute('href', '/programados');
    expect(within(group).getByRole('link', { name: 'Ingresos' })).toHaveAttribute('href', '/programados?tipo=ingresos');
    expect(within(group).getByRole('link', { name: 'Ingresos' })).toHaveAttribute('aria-current', 'true');
    expect(within(group).getByRole('link', { name: 'Gastos' })).not.toHaveAttribute('aria-current');
  });
});

describe('ExpectedIncomeNote', () => {
  const lowest = (amount: string) => ({ date: '2026-03-30', balance: cop(amount) });

  it('no aparece sin ingresos esperados', () => {
    const { container } = render(<ExpectedIncomeNote expectedIncome={cop('0')} availableWithIncome={cop('500')} lowestWithIncome={lowest('500')} />);
    expect(container).toBeEmptyDOMElement();
    const again = render(<ExpectedIncomeNote />);
    expect(again.container).toBeEmptyDOMElement();
  });

  it('muestra lo que habría si llega lo esperado', () => {
    render(<ExpectedIncomeNote expectedIncome={cop('3000000')} availableWithIncome={cop('3500000')} lowestWithIncome={lowest('500000')} />);
    expect(screen.getByText('Si llega lo que esperas recibir: $ 3.500.000')).toBeInTheDocument();
    expect(screen.queryByText(/Ojo/)).not.toBeInTheDocument();
  });

  it('avisa el día en que faltaría plata antes de que llegue', () => {
    render(<ExpectedIncomeNote expectedIncome={cop('3000000')} availableWithIncome={cop('2600000')} lowestWithIncome={lowest('-400000')} />);
    expect(screen.getByText('Ojo: el lunes 30 de marzo te faltarían $ 400.000 antes de que llegue lo que esperas.')).toBeInTheDocument();
  });
});
