import { DomainValidationError } from '../shared/domain-validation.error';
import { InterestRate, looksLikeAnnualAsMonthly, parseRatePercent } from './interest-rate';

/** Verificación independiente (sin usar la búsqueda binaria del código): p es correcto si
 *  ((1e6 + p - 1/2) / 1e6)^12 <= 1 + EA/1e6 < ((1e6 + p + 1/2) / 1e6)^12, todo en enteros. */
function isNearestMonthlyPpm(eaPpm: number, p: number): boolean {
  const base = 2_000_000n;
  const lo = (base + 2n * BigInt(p) - 1n) ** 12n * 1_000_000n;
  const hi = (base + 2n * BigInt(p) + 1n) ** 12n * 1_000_000n;
  const target = base ** 12n * (1_000_000n + BigInt(eaPpm));
  return lo <= target && target < hi;
}

describe('parseRatePercent', () => {
  it.each([
    ['1,87', 18_700],
    ['1.87', 18_700],
    ['26', 260_000],
    ['0,0001', 1],
    ['2', 20_000],
    ['200', 2_000_000],
    ['0.5', 5_000],
  ])('convierte %s a %i ppm', (text, ppm) => {
    expect(parseRatePercent(text)).toBe(ppm);
  });

  it.each(['', '  ', 'abc', '1,2,3', '1,23456', '-1', '-1,5', '0', '0,0000', '1e3', ',5', '5,', '1 2', '+3', '1,2.3'])(
    'rechaza %j',
    (text) => {
      expect(() => parseRatePercent(text)).toThrow(DomainValidationError);
    },
  );
});

describe('InterestRate', () => {
  it('M.V.: la tasa mensual es la misma', () => {
    const r = InterestRate.create({ basis: 'MV', ppm: 20_000 });
    expect(r.monthlyPpm).toBe(20_000);
  });

  it('E.A. 26,82 % equivale a 19.997 ppm mensual', () => {
    expect(InterestRate.create({ basis: 'EA', ppm: 268_200 }).monthlyPpm).toBe(19_997);
  });

  it.each([1, 10_000, 100_000, 268_200, 500_000, 1_000_000, 1_999_999, 2_000_000])(
    'E.A. %i ppm coincide con la verificación independiente',
    (ea) => {
      const p = InterestRate.create({ basis: 'EA', ppm: ea }).monthlyPpm;
      expect(isNearestMonthlyPpm(ea, p)).toBe(true);
    },
  );

  it('E.A. 0,0001 % redondea a 0 ppm mensual y 200 % queda en su rango', () => {
    expect(InterestRate.create({ basis: 'EA', ppm: 1 }).monthlyPpm).toBe(0);
    const p = InterestRate.create({ basis: 'EA', ppm: 2_000_000 }).monthlyPpm;
    expect(p).toBeGreaterThan(94_000);
    expect(p).toBeLessThan(96_000);
  });

  it('barrido: 300 valores de E.A. coinciden con la verificación independiente', () => {
    for (let ea = 1; ea <= 2_000_000; ea += 6_667) {
      const p = InterestRate.create({ basis: 'EA', ppm: ea }).monthlyPpm;
      expect(isNearestMonthlyPpm(ea, p)).toBe(true);
    }
  });

  it('valida topes, enteros y positivos', () => {
    expect(() => InterestRate.create({ basis: 'MV', ppm: 100_001 })).toThrow(DomainValidationError);
    expect(() => InterestRate.create({ basis: 'EA', ppm: 2_000_001 })).toThrow(DomainValidationError);
    expect(() => InterestRate.create({ basis: 'MV', ppm: 0 })).toThrow(DomainValidationError);
    expect(() => InterestRate.create({ basis: 'MV', ppm: -5 })).toThrow(DomainValidationError);
    expect(() => InterestRate.create({ basis: 'MV', ppm: 1.5 })).toThrow(DomainValidationError);
    expect(() => InterestRate.create({ basis: 'XX' as 'MV', ppm: 5 })).toThrow(DomainValidationError);
    expect(InterestRate.create({ basis: 'MV', ppm: 100_000 }).ppm).toBe(100_000);
    expect(InterestRate.create({ basis: 'EA', ppm: 2_000_000 }).ppm).toBe(2_000_000);
  });

  it('avisa si una M.V. parece una tasa anual (más de 4 %)', () => {
    expect(looksLikeAnnualAsMonthly(InterestRate.create({ basis: 'MV', ppm: 40_001 }))).toBe(true);
    expect(looksLikeAnnualAsMonthly(InterestRate.create({ basis: 'MV', ppm: 40_000 }))).toBe(false);
    expect(looksLikeAnnualAsMonthly(InterestRate.create({ basis: 'EA', ppm: 1_500_000 }))).toBe(false);
  });
});
