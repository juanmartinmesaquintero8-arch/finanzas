import { BalanceSnapshot } from '../ledger/balance-calculator';
import { Money } from '../money/money';
import { ProjectionEngine } from '../projection/projection-engine';
import { DomainValidationError } from '../shared/domain-validation.error';
import { ScheduledIncome } from './scheduled-income';

const cop = (n: number) => Money.of(n, 'COP');
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (dates: Date[]) => dates.map((x) => x.toISOString().slice(0, 10));

const base = {
  id: 'si-1',
  description: 'Sueldo',
  amount: cop(3_000_000),
  accountId: 'bancolombia',
  frequency: 'MONTHLY' as const,
  startDate: d('2026-01-30'),
};

describe('ScheduledIncome', () => {
  it('calcula las ocurrencias pendientes igual que un gasto programado', () => {
    const si = ScheduledIncome.create(base);
    expect(iso(si.pendingOccurrences(d('2026-10-24'), d('2026-12-31')))).toEqual(['2026-10-30', '2026-11-30', '2026-12-30']);
  });

  it('respeta la fecha de fin y lo ya recibido (settledThrough)', () => {
    const si = ScheduledIncome.create({ ...base, endDate: d('2026-11-30'), settledThrough: d('2026-10-30') });
    expect(iso(si.pendingOccurrences(d('2026-10-01'), d('2026-12-31')))).toEqual(['2026-11-30']);
  });

  it('markSettled devuelve una copia nueva y conserva la categoría', () => {
    const si = ScheduledIncome.create({ ...base, category: 'Salario' });
    const got = si.markSettled(d('2026-10-30'));
    expect(got).toBeInstanceOf(ScheduledIncome);
    expect(got.settledThrough).toEqual(d('2026-10-30'));
    expect(got.category).toBe('Salario');
    expect(si.settledThrough).toBeUndefined();
  });

  it('la categoría es opcional y una vacía queda sin categoría', () => {
    expect(ScheduledIncome.create(base).category).toBeUndefined();
    expect(ScheduledIncome.create({ ...base, category: '   ' }).category).toBeUndefined();
    expect(ScheduledIncome.create({ ...base, category: ' Salario ' }).category).toBe('Salario');
  });

  it('toProps permite reconstruirlo igual', () => {
    const si = ScheduledIncome.create({ ...base, endDate: d('2027-01-30'), category: 'Salario' });
    expect(ScheduledIncome.create(si.toProps())).toEqual(si);
  });

  it('valida con mensajes propios del ingreso', () => {
    expect(() => ScheduledIncome.create({ ...base, description: '  ' })).toThrow('La descripción del ingreso programado es obligatoria');
    expect(() => ScheduledIncome.create({ ...base, amount: cop(0) })).toThrow('El monto del ingreso programado debe ser mayor que cero');
    expect(() => ScheduledIncome.create({ ...base, endDate: d('2026-01-01') })).toThrow(DomainValidationError);
  });

  it('el compilador impide restar un ingreso como si fuera un gasto', () => {
    const si = ScheduledIncome.create(base);
    const engine = new ProjectionEngine('COP');
    const snapshot = new BalanceSnapshot([], cop(0));
    // @ts-expect-error un ingreso programado no es un gasto programado
    engine.project({ snapshot, scheduledExpenses: [si], from: d('2026-10-24'), to: d('2026-10-31') });
  });
});
