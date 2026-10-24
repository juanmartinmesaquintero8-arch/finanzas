import { Money } from '../money/money';
import { Account } from './account';
import { DomainValidationError } from '../shared/domain-validation.error';

describe('Account', () => {
  const base = {
    id: 'acc-1',
    name: 'Bancolombia',
    type: 'BANK' as const,
    initialBalance: Money.of(1_000_000, 'COP'),
  };

  it('se crea con nombre, tipo y saldo inicial', () => {
    const acc = Account.create(base);
    expect(acc.name).toBe('Bancolombia');
    expect(acc.currency).toBe('COP');
    expect(acc.initialBalance.amount).toBe(1_000_000n);
  });

  it('recorta espacios del nombre', () => {
    expect(Account.create({ ...base, name: '  Nu  ' }).name).toBe('Nu');
  });

  it('rechaza nombre vacío', () => {
    expect(() => Account.create({ ...base, name: '   ' })).toThrow(DomainValidationError);
  });

  it('rechaza tipo desconocido', () => {
    expect(() => Account.create({ ...base, type: 'CRYPTO' as never })).toThrow(DomainValidationError);
  });
});
