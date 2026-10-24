import { describe, expect, it } from 'vitest';
import { groupTransactionsByDay, horizonEnd, nextOccurrence, transactionTitle } from './domain-helpers';
import { validateScheduledForm, validateTransactionForm } from './validation';
import type { Transaction } from './types';

const tx = (over: Partial<Transaction>): Transaction => ({
  id: 'x',
  type: 'EXPENSE',
  amount: { amount: '1000', currency: 'COP' },
  date: '2026-03-10T00:00:00.000Z',
  description: 'algo',
  category: null,
  accountId: 'a1',
  fromAccountId: null,
  toAccountId: null,
  ...over,
});

describe('groupTransactionsByDay', () => {
  it('agrupa por día conservando el orden recibido', () => {
    const groups = groupTransactionsByDay([
      tx({ id: '1', date: '2026-03-10T00:00:00.000Z' }),
      tx({ id: '2', date: '2026-03-10T00:00:00.000Z' }),
      tx({ id: '3', date: '2026-03-08T00:00:00.000Z' }),
    ]);
    expect(groups.map((g) => g.day)).toEqual(['2026-03-10', '2026-03-08']);
    expect(groups[0]!.items.map((t) => t.id)).toEqual(['1', '2']);
  });
  it('lista vacía -> sin grupos', () => expect(groupTransactionsByDay([])).toEqual([]));
});

describe('transactionTitle', () => {
  it('transferencia: "Origen → Destino"', () => {
    const names = new Map([['a', 'Bancolombia'], ['b', 'Nu']]);
    expect(transactionTitle(tx({ type: 'TRANSFER', accountId: null, fromAccountId: 'a', toAccountId: 'b' }), names)).toBe(
      'Bancolombia → Nu',
    );
  });
  it('ingreso/gasto: nombre de la cuenta', () => {
    expect(transactionTitle(tx({ accountId: 'a' }), new Map([['a', 'Efectivo']]))).toBe('Efectivo');
  });
});

describe('horizonEnd', () => {
  const today = '2026-03-10';
  it('fin de mes, 30 días y 3 meses', () => {
    expect(horizonEnd('month', today)).toBe('2026-03-31');
    expect(horizonEnd('30d', today)).toBe('2026-04-09');
    expect(horizonEnd('3m', today)).toBe('2026-06-10');
  });
});

describe('nextOccurrence', () => {
  it('mensual: siguiente día 5 desde hoy', () => {
    expect(nextOccurrence({ frequency: 'MONTHLY', startDate: '2026-01-05', endDate: null, settledThrough: null }, '2026-03-10')).toBe('2026-04-05');
  });
  it('mensual con settledThrough: la siguiente tras lo liquidado', () => {
    expect(nextOccurrence({ frequency: 'MONTHLY', startDate: '2026-01-05', endDate: null, settledThrough: '2026-03-05' }, '2026-03-10')).toBe('2026-04-05');
    expect(nextOccurrence({ frequency: 'MONTHLY', startDate: '2026-01-05', endDate: null, settledThrough: '2026-01-05' }, '2026-03-10')).toBe('2026-02-05');
  });
  it('mensual día 31 se acota al fin de mes', () => {
    expect(nextOccurrence({ frequency: 'MONTHLY', startDate: '2026-01-31', endDate: null, settledThrough: '2026-01-31' }, '2026-01-31')).toBe('2026-02-28');
  });
  it('semanal y quincenal', () => {
    expect(nextOccurrence({ frequency: 'WEEKLY', startDate: '2026-03-02', endDate: null, settledThrough: '2026-03-09' }, '2026-03-10')).toBe('2026-03-16');
    expect(nextOccurrence({ frequency: 'BIWEEKLY', startDate: '2026-03-02', endDate: null, settledThrough: null }, '2026-03-10')).toBe('2026-03-02');
  });
  it('única: su fecha, o null si ya liquidada', () => {
    expect(nextOccurrence({ frequency: 'ONCE', startDate: '2026-05-01', endDate: null, settledThrough: null }, '2026-03-10')).toBe('2026-05-01');
    expect(nextOccurrence({ frequency: 'ONCE', startDate: '2026-05-01', endDate: null, settledThrough: '2026-05-01' }, '2026-03-10')).toBeNull();
  });
  it('null si pasó endDate', () => {
    expect(nextOccurrence({ frequency: 'MONTHLY', startDate: '2026-01-05', endDate: '2026-03-31', settledThrough: '2026-03-05' }, '2026-03-10')).toBeNull();
  });
});

describe('validateTransactionForm', () => {
  const base = { type: 'EXPENSE' as const, amountText: '50.000', date: '2026-03-10', description: 'Mercado', category: 'Comida', accountId: 'a1', fromAccountId: '', toAccountId: '' };
  it('válido -> input para la API', () => {
    const r = validateTransactionForm(base);
    expect(r).toEqual({
      ok: true,
      value: { type: 'EXPENSE', amount: '50000', date: '2026-03-10', description: 'Mercado', category: 'Comida', accountId: 'a1' },
    });
  });
  it('mensajes claros en español', () => {
    const r = validateTransactionForm({ ...base, amountText: '', description: ' ', accountId: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.amount).toBe('Escribe un monto mayor a cero.');
      expect(r.errors.description).toBe('Escribe una descripción.');
      expect(r.errors.account).toBe('Elige una cuenta.');
    }
  });
  it('transferencia: requiere origen y destino distintos', () => {
    const t = { ...base, type: 'TRANSFER' as const, accountId: '', fromAccountId: 'a', toAccountId: 'a' };
    const r = validateTransactionForm(t);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.account).toBe('La cuenta de origen y la de destino deben ser distintas.');
    const ok = validateTransactionForm({ ...t, toAccountId: 'b' });
    expect(ok).toMatchObject({ ok: true, value: { type: 'TRANSFER', fromAccountId: 'a', toAccountId: 'b' } });
    if (ok.ok) expect(ok.value.accountId).toBeUndefined();
  });
  it('fecha obligatoria', () => {
    const r = validateTransactionForm({ ...base, date: '' });
    expect(r.ok).toBe(false);
  });
});

describe('validateScheduledForm', () => {
  it('valida y convierte', () => {
    const r = validateScheduledForm({ description: 'Arriendo', amountText: '1.200.000', accountId: 'a1', frequency: 'MONTHLY', startDate: '2026-04-05' });
    expect(r).toEqual({ ok: true, value: { description: 'Arriendo', amount: '1200000', accountId: 'a1', frequency: 'MONTHLY', startDate: '2026-04-05' } });
  });
  it('errores', () => {
    const r = validateScheduledForm({ description: '', amountText: '0', accountId: '', frequency: 'MONTHLY', startDate: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['account', 'amount', 'description', 'startDate']);
  });
});
