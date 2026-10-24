import { describe, expect, it } from 'vitest';
import {
  formatDayHeading,
  formatGroupedDigits,
  formatMoney,
  formatMoneyView,
  frequencyLabel,
  parseAmountInput,
} from './format';

describe('formatMoney', () => {
  it('usa puntos de miles, sin decimales y con prefijo $', () => {
    expect(formatMoney(1234567n)).toBe('$ 1.234.567');
    expect(formatMoney(0n)).toBe('$ 0');
    expect(formatMoney(999n)).toBe('$ 999');
  });
  it('maneja negativos', () => {
    expect(formatMoney(-50000n)).toBe('-$ 50.000');
  });
  it('acepta strings enteros (vista de la API) y bigint enormes sin perder precisión', () => {
    expect(formatMoney('9007199254740993')).toBe('$ 9.007.199.254.740.993');
    expect(formatMoneyView({ amount: '3000000', currency: 'COP' })).toBe('$ 3.000.000');
  });
});

describe('formatGroupedDigits / parseAmountInput', () => {
  it('formatea en vivo lo que escribe el usuario', () => {
    expect(formatGroupedDigits('1234567')).toBe('1.234.567');
    expect(formatGroupedDigits('12a3')).toBe('123');
    expect(formatGroupedDigits('')).toBe('');
    expect(formatGroupedDigits('000')).toBe('0');
  });
  it('parsea a entero string o null si es inválido/vacío/cero', () => {
    expect(parseAmountInput('1.234.567')).toBe('1234567');
    expect(parseAmountInput('$ 50.000')).toBe('50000');
    expect(parseAmountInput('')).toBeNull();
    expect(parseAmountInput('0')).toBeNull();
    expect(parseAmountInput('abc')).toBeNull();
  });
});

describe('formatDayHeading', () => {
  const today = new Date('2026-03-10T15:00:00Z');
  it('dice Hoy y Ayer', () => {
    expect(formatDayHeading('2026-03-10', today)).toBe('Hoy');
    expect(formatDayHeading('2026-03-09', today)).toBe('Ayer');
  });
  it('formatea otras fechas en español', () => {
    expect(formatDayHeading('2026-03-05', today)).toBe('jueves 5 de marzo');
    expect(formatDayHeading('2025-12-31', today)).toBe('miércoles 31 de diciembre de 2025');
  });
});

describe('frequencyLabel', () => {
  it('describe la frecuencia de forma legible', () => {
    expect(frequencyLabel('MONTHLY', '2026-01-05')).toBe('Cada mes, día 5');
    expect(frequencyLabel('WEEKLY', '2026-01-05')).toBe('Cada semana, lunes');
    expect(frequencyLabel('BIWEEKLY', '2026-01-05')).toBe('Cada 2 semanas, lunes');
    expect(frequencyLabel('ONCE', '2026-01-05')).toBe('Una sola vez');
  });
});
