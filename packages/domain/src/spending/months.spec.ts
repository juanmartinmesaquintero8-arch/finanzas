import { describe, expect, it } from 'vitest';
import { MAX_SPENDING_MONTHS, addMonths, clampSpendingMonth, daysInMonth, isMonthKey, spendingWindow } from './months';

describe('meses', () => {
  it('reconoce claves de mes válidas', () => {
    expect(isMonthKey('2026-10')).toBe(true);
    for (const bad of ['2026-13', '2026-00', '2026-1', '26-10', '2026-10-01', '', 'abc']) expect(isMonthKey(bad)).toBe(false);
  });

  it('suma y resta meses cruzando años', () => {
    expect(addMonths('2026-11', 1)).toBe('2026-12');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-03', -23)).toBe('2024-04');
  });

  it('cuenta los días del mes, con año bisiesto', () => {
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2028-02')).toBe(29);
    expect(daysInMonth('2026-03')).toBe(31);
    expect(daysInMonth('2026-04')).toBe(30);
  });

  it('la ventana abarca 24 meses contando el actual', () => {
    expect(MAX_SPENDING_MONTHS).toBe(24);
    expect(spendingWindow('2026-11-08')).toEqual({ current: '2026-11', oldest: '2024-12' });
  });

  it('acota el mes pedido a la ventana; lo inválido cae en el mes actual', () => {
    const today = '2026-11-08';
    expect(clampSpendingMonth('2026-10', today)).toBe('2026-10');
    expect(clampSpendingMonth('2027-03', today)).toBe('2026-11');
    expect(clampSpendingMonth('2024-12', today)).toBe('2024-12');
    expect(clampSpendingMonth('2024-11', today)).toBe('2024-12');
    expect(clampSpendingMonth('basura', today)).toBe('2026-11');
    expect(clampSpendingMonth(null, today)).toBe('2026-11');
    expect(clampSpendingMonth(undefined, today)).toBe('2026-11');
  });
});
