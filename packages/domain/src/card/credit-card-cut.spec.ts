import { CreditCard } from './credit-card';

const base = {
  id: 'c1',
  name: 'Visa',
  dueDay: 15,
  paymentAccountId: 'bancolombia',
  fee: { kind: 'NONE' as const },
  feeStartMonth: '2026-11',
};

describe('CreditCard: día de corte', () => {
  it('es opcional', () => {
    expect(CreditCard.create(base).cutDay).toBeUndefined();
  });

  it('guarda el día de corte y lo devuelve en toProps', () => {
    const c = CreditCard.create({ ...base, cutDay: 5 });
    expect(c.cutDay).toBe(5);
    expect(c.toProps().cutDay).toBe(5);
    expect(CreditCard.create(c.toProps()).cutDay).toBe(5);
  });

  it.each([0, 32, -1, 1.5, Number.NaN])('rechaza %s con el mensaje de rango', (cutDay) => {
    expect(() => CreditCard.create({ ...base, cutDay })).toThrow('El día de corte va de 1 a 31.');
  });

  it('rechaza un corte igual al día de pago', () => {
    expect(() => CreditCard.create({ ...base, cutDay: 15 })).toThrow('El día de corte no puede ser el mismo día de pago.');
  });

  it('acepta los extremos 1 y 31', () => {
    expect(CreditCard.create({ ...base, cutDay: 1 }).cutDay).toBe(1);
    expect(CreditCard.create({ ...base, cutDay: 31 }).cutDay).toBe(31);
  });
});
