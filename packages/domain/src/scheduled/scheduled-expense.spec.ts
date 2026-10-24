import { Money } from '../money/money';
import { DomainValidationError } from '../shared/domain-validation.error';
import { ScheduledExpense } from './scheduled-expense';

const cop = (n: number) => Money.of(n, 'COP');
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (dates: Date[]) => dates.map((x) => x.toISOString().slice(0, 10));

const base = {
  id: 'se-1',
  description: 'Arriendo',
  amount: cop(1_200_000),
  accountId: 'bancolombia',
  frequency: 'MONTHLY' as const,
  startDate: d('2026-01-05'),
};

describe('ScheduledExpense', () => {
  it('calcula las ocurrencias pendientes en un rango', () => {
    const se = ScheduledExpense.create(base);
    expect(iso(se.pendingOccurrences(d('2026-10-24'), d('2026-12-31')))).toEqual(['2026-11-05', '2026-12-05']);
  });

  it('no genera ocurrencias después de la fecha de fin', () => {
    const se = ScheduledExpense.create({ ...base, endDate: d('2026-11-30') });
    expect(iso(se.pendingOccurrences(d('2026-10-24'), d('2026-12-31')))).toEqual(['2026-11-05']);
  });

  it('excluye ocurrencias ya liquidadas (settledThrough)', () => {
    const se = ScheduledExpense.create({ ...base, settledThrough: d('2026-11-05') });
    expect(iso(se.pendingOccurrences(d('2026-10-01'), d('2026-12-31')))).toEqual(['2026-12-05']);
  });

  it('markSettled devuelve una nueva instancia liquidada hasta esa fecha', () => {
    const se = ScheduledExpense.create(base);
    const paid = se.markSettled(d('2026-11-05'));
    expect(paid.settledThrough).toEqual(d('2026-11-05'));
    expect(se.settledThrough).toBeUndefined();
  });

  it('normaliza fechas al inicio del día UTC', () => {
    const se = ScheduledExpense.create({ ...base, startDate: new Date('2026-01-05T18:30:00Z') });
    expect(se.startDate).toEqual(d('2026-01-05'));
  });

  it('rechaza montos no positivos', () => {
    expect(() => ScheduledExpense.create({ ...base, amount: cop(0) })).toThrow(DomainValidationError);
  });

  it('rechaza descripción vacía', () => {
    expect(() => ScheduledExpense.create({ ...base, description: ' ' })).toThrow(DomainValidationError);
  });

  it('rechaza fecha de fin anterior al inicio', () => {
    expect(() => ScheduledExpense.create({ ...base, endDate: d('2025-12-31') })).toThrow(DomainValidationError);
  });
});
