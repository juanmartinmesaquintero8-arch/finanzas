import { DomainValidationError } from '../shared/domain-validation.error';
import { MonthlyRecurrence, OnceRecurrence, RecurrenceFactory, WeeklyRecurrence } from './recurrence';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (dates: Date[]) => dates.map((x) => x.toISOString().slice(0, 10));

describe('Estrategias de recurrencia', () => {
  describe('OnceRecurrence', () => {
    it('ocurre solo en la fecha de inicio si cae en el rango', () => {
      const r = new OnceRecurrence();
      expect(iso(r.occurrences(d('2026-11-05'), d('2026-11-01'), d('2026-11-30')))).toEqual(['2026-11-05']);
      expect(r.occurrences(d('2026-12-05'), d('2026-11-01'), d('2026-11-30'))).toEqual([]);
    });
  });

  describe('MonthlyRecurrence', () => {
    it('genera una ocurrencia por mes en el día de la fecha de inicio', () => {
      const r = new MonthlyRecurrence();
      expect(iso(r.occurrences(d('2026-09-15'), d('2026-10-01'), d('2026-12-31')))).toEqual([
        '2026-10-15', '2026-11-15', '2026-12-15',
      ]);
    });

    it('ajusta al último día cuando el mes es más corto', () => {
      const r = new MonthlyRecurrence();
      expect(iso(r.occurrences(d('2026-01-31'), d('2026-01-01'), d('2026-04-30')))).toEqual([
        '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30',
      ]);
    });

    it('incluye los extremos del rango', () => {
      const r = new MonthlyRecurrence();
      expect(iso(r.occurrences(d('2026-10-01'), d('2026-10-01'), d('2026-11-01')))).toEqual(['2026-10-01', '2026-11-01']);
    });
  });

  describe('WeeklyRecurrence', () => {
    it('genera ocurrencias cada N semanas', () => {
      const r = new WeeklyRecurrence(2);
      expect(iso(r.occurrences(d('2026-10-02'), d('2026-10-10'), d('2026-11-15')))).toEqual([
        '2026-10-16', '2026-10-30', '2026-11-13',
      ]);
    });

    it('rechaza intervalos no positivos', () => {
      expect(() => new WeeklyRecurrence(0)).toThrow(DomainValidationError);
    });
  });

  describe('RecurrenceFactory', () => {
    it('construye la estrategia según la frecuencia', () => {
      expect(RecurrenceFactory.create('ONCE')).toBeInstanceOf(OnceRecurrence);
      expect(RecurrenceFactory.create('MONTHLY')).toBeInstanceOf(MonthlyRecurrence);
      expect(RecurrenceFactory.create('WEEKLY')).toBeInstanceOf(WeeklyRecurrence);
      expect(RecurrenceFactory.create('BIWEEKLY')).toEqual(new WeeklyRecurrence(2));
    });

    it('rechaza frecuencias desconocidas', () => {
      expect(() => RecurrenceFactory.create('DAILY' as never)).toThrow(DomainValidationError);
    });
  });
});
