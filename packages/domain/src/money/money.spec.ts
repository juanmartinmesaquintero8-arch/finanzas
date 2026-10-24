import { Money } from './money';
import { CurrencyMismatchError, InvalidMoneyError } from './money.errors';

describe('Money', () => {
  it('se crea en unidades mínimas enteras', () => {
    const m = Money.of(150_000n, 'COP');
    expect(m.amount).toBe(150_000n);
    expect(m.currency).toBe('COP');
  });

  it('acepta enteros number y los convierte a bigint', () => {
    expect(Money.of(2500, 'COP').amount).toBe(2500n);
  });

  it('rechaza montos con decimales', () => {
    expect(() => Money.of(10.5, 'COP')).toThrow(InvalidMoneyError);
  });

  it('rechaza monedas inválidas', () => {
    expect(() => Money.of(1, 'pesos')).toThrow(InvalidMoneyError);
  });

  it('zero crea un monto cero', () => {
    expect(Money.zero('COP').isZero()).toBe(true);
  });

  it('suma y resta sin mutar', () => {
    const a = Money.of(1000, 'COP');
    const b = Money.of(300, 'COP');
    expect(a.add(b).amount).toBe(1300n);
    expect(a.subtract(b).amount).toBe(700n);
    expect(a.amount).toBe(1000n);
  });

  it('no permite operar monedas distintas', () => {
    expect(() => Money.of(1, 'COP').add(Money.of(1, 'USD'))).toThrow(CurrencyMismatchError);
  });

  it('negate, isNegative, isPositive', () => {
    const m = Money.of(500, 'COP').negate();
    expect(m.amount).toBe(-500n);
    expect(m.isNegative()).toBe(true);
    expect(m.negate().isPositive()).toBe(true);
  });

  it('multiplica por un entero', () => {
    expect(Money.of(250, 'COP').multiply(4).amount).toBe(1000n);
  });

  it('compara por valor', () => {
    expect(Money.of(5, 'COP').equals(Money.of(5n, 'COP'))).toBe(true);
    expect(Money.of(5, 'COP').equals(Money.of(5, 'USD'))).toBe(false);
    expect(Money.of(3, 'COP').greaterThan(Money.of(2, 'COP'))).toBe(true);
  });

  it('sum de una lista vacía es cero', () => {
    expect(Money.sum([], 'COP').isZero()).toBe(true);
    expect(Money.sum([Money.of(1, 'COP'), Money.of(2, 'COP')], 'COP').amount).toBe(3n);
  });

  it('serializa a JSON como string para no perder precisión', () => {
    expect(Money.of(7, 'COP').toJSON()).toEqual({ amount: '7', currency: 'COP' });
  });
});
