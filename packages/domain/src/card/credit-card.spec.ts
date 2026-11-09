import { Money } from '../money/money';
import { DomainValidationError } from '../shared/domain-validation.error';
import { CreditCard } from './credit-card';
import { InterestRate } from './interest-rate';

const cop = (n: number) => Money.of(n, 'COP');
const base = {
  id: 'c1',
  name: ' Visa ',
  dueDay: 15,
  paymentAccountId: 'bancolombia',
  fee: { kind: 'NONE' as const },
  feeStartMonth: '2026-11',
};

describe('CreditCard', () => {
  it('crea una tarjeta válida y recorta el nombre', () => {
    const c = CreditCard.create(base);
    expect(c.name).toBe('Visa');
    expect(c.dueDay).toBe(15);
    expect(c.rate).toBeUndefined();
    expect(c.feesSettledThrough).toBeUndefined();
  });

  it('guarda la tasa y los datos de manejo', () => {
    const rate = InterestRate.create({ basis: 'MV', ppm: 20_000 });
    const c = CreditCard.create({ ...base, rate, fee: { kind: 'FIXED_MONTHLY', amount: cop(30_000) }, feesSettledThrough: '2026-12' });
    expect(c.rate).toBe(rate);
    expect(c.fee).toEqual({ kind: 'FIXED_MONTHLY', amount: cop(30_000) });
    expect(c.feesSettledThrough).toBe('2026-12');
  });

  it('exige nombre', () => {
    expect(() => CreditCard.create({ ...base, name: '   ' })).toThrow(DomainValidationError);
  });

  it.each([0, 32, 1.5, -1, Number.NaN])('rechaza dueDay %s', (dueDay) => {
    expect(() => CreditCard.create({ ...base, dueDay })).toThrow(DomainValidationError);
  });

  it('acepta dueDay 1 y 31', () => {
    expect(CreditCard.create({ ...base, dueDay: 1 }).dueDay).toBe(1);
    expect(CreditCard.create({ ...base, dueDay: 31 }).dueDay).toBe(31);
  });

  it('el monto de manejo debe ser positivo si cobra', () => {
    expect(() => CreditCard.create({ ...base, fee: { kind: 'FIXED_MONTHLY', amount: cop(0) } })).toThrow(DomainValidationError);
    expect(() => CreditCard.create({ ...base, fee: { kind: 'ON_MOVEMENT', amount: cop(-5) } })).toThrow(DomainValidationError);
    expect(CreditCard.create({ ...base, fee: { kind: 'ON_MOVEMENT', amount: cop(1) } }).fee.kind).toBe('ON_MOVEMENT');
  });

  it.each(['2026-13', '2026-00', '26-11', '2026-1', '2026-11-01', ''])('rechaza feeStartMonth %j', (feeStartMonth) => {
    expect(() => CreditCard.create({ ...base, feeStartMonth })).toThrow(DomainValidationError);
  });

  it('rechaza feesSettledThrough con formato inválido', () => {
    expect(() => CreditCard.create({ ...base, feesSettledThrough: '2026-99' })).toThrow(DomainValidationError);
  });

  it('exige cuenta de pago', () => {
    expect(() => CreditCard.create({ ...base, paymentAccountId: '' })).toThrow(DomainValidationError);
  });

  it('toProps devuelve lo necesario para recrearla', () => {
    const c = CreditCard.create(base);
    expect(CreditCard.create(c.toProps()).toProps()).toEqual(c.toProps());
  });
});
