import { Money } from '../money/money';
import { DomainValidationError } from '../shared/domain-validation.error';
import { CardPaymentProps, createCardPayment, validatePaymentDate } from './card-payment';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const cop = (n: bigint | number) => Money.of(n, 'COP');

const base = (o: Partial<CardPaymentProps> = {}): CardPaymentProps => ({
  id: 'pay1',
  cardId: 'c1',
  seq: 1,
  paidOn: d('2026-02-15'),
  fromAccountId: 'a1',
  total: cop(150_000),
  allocations: [
    { kind: 'FEE', month: '2026-01', amount: cop(26_000) },
    { kind: 'INSTALLMENT', purchaseId: 'p1', number: 1, interest: cop(24_000), capital: cop(100_000) },
  ],
  transactionIds: ['t1'],
  ...o,
});

describe('createCardPayment', () => {
  it('acepta un pago cuyo reparto suma exactamente el total', () => {
    const p = createCardPayment(base());
    expect(p.total.amount).toBe(150_000n);
    expect(p.paidOn).toEqual(d('2026-02-15'));
    expect(p.allocations).toHaveLength(2);
  });

  it('normaliza la fecha al día', () => {
    expect(createCardPayment(base({ paidOn: new Date('2026-02-15T18:30:00Z') })).paidOn).toEqual(d('2026-02-15'));
  });

  it.each([0, -1, 1.5])('rechaza seq %s', (seq) => {
    expect(() => createCardPayment(base({ seq }))).toThrow(DomainValidationError);
  });

  it('rechaza total cero o negativo', () => {
    expect(() => createCardPayment(base({ total: cop(0), allocations: [] }))).toThrow('El pago debe ser mayor que cero.');
  });

  it('rechaza un reparto que no suma el total (uno de más y uno de menos)', () => {
    expect(() => createCardPayment(base({ total: cop(150_001) }))).toThrow('El reparto del pago no suma el total.');
    expect(() => createCardPayment(base({ total: cop(149_999) }))).toThrow('El reparto del pago no suma el total.');
  });

  it('rechaza asignaciones en cero o negativas', () => {
    expect(() =>
      createCardPayment(base({ total: cop(100_000), allocations: [{ kind: 'EXTRA', purchaseId: 'p1', capital: cop(0) }, { kind: 'FEE', month: '2026-01', amount: cop(100_000) }] })),
    ).toThrow('Cada parte del pago debe ser mayor que cero.');
    expect(() =>
      createCardPayment(base({ total: cop(100_000), allocations: [{ kind: 'INSTALLMENT', purchaseId: 'p1', number: 1, interest: cop(-1), capital: cop(100_001) }] })),
    ).toThrow('Cada parte del pago debe ser mayor que cero.');
    expect(() =>
      createCardPayment(base({ total: cop(0n + 1n), allocations: [{ kind: 'INSTALLMENT', purchaseId: 'p1', number: 1, interest: cop(0), capital: cop(0) }, { kind: 'FEE', month: '2026-01', amount: cop(1) }] })),
    ).toThrow('Cada parte del pago debe ser mayor que cero.');
  });

  it('una cuota puede llevar solo interés o solo capital', () => {
    expect(() =>
      createCardPayment(base({ total: cop(24_000), allocations: [{ kind: 'INSTALLMENT', purchaseId: 'p1', number: 1, interest: cop(24_000), capital: cop(0) }] })),
    ).not.toThrow();
  });

  it('extraMode presente si y solo si hay plata de más', () => {
    const extra = { kind: 'EXTRA' as const, purchaseId: 'p1', capital: cop(150_000) };
    expect(() => createCardPayment(base({ allocations: [extra] }))).toThrow('Elige qué hacer con la plata de más.');
    expect(() => createCardPayment(base({ extraMode: 'SHORTEN' }))).toThrow('Solo se elige qué hacer con la plata de más cuando la hay.');
    expect(createCardPayment(base({ allocations: [extra], extraMode: 'LOWER' })).extraMode).toBe('LOWER');
  });

  it('rechaza mes de manejo mal escrito, cuota inválida y monedas mezcladas', () => {
    expect(() => createCardPayment(base({ total: cop(1), allocations: [{ kind: 'FEE', month: '2026-13', amount: cop(1) }] }))).toThrow(DomainValidationError);
    expect(() =>
      createCardPayment(base({ total: cop(1), allocations: [{ kind: 'INSTALLMENT', purchaseId: 'p1', number: 0, interest: cop(0), capital: cop(1) }] })),
    ).toThrow(DomainValidationError);
    expect(() => createCardPayment(base({ total: cop(1), allocations: [{ kind: 'FEE', month: '2026-01', amount: Money.of(1, 'USD') }] }))).toThrow();
  });

  it('montos por encima de Number.MAX_SAFE_INTEGER se suman exactos', () => {
    const big = 9_007_199_254_740_993n;
    const p = createCardPayment(
      base({ total: cop(big * 2n), allocations: [{ kind: 'EXTRA', purchaseId: 'p1', capital: cop(big) }, { kind: 'EXTRA', purchaseId: 'p2', capital: cop(big) }], extraMode: 'SHORTEN' }),
    );
    expect(p.total.amount).toBe(18_014_398_509_481_986n);
  });
});

describe('validatePaymentDate', () => {
  const today = d('2026-03-10');
  const prev = [createCardPayment(base({ paidOn: d('2026-03-01') })), createCardPayment(base({ id: 'pay0', seq: 2, paidOn: d('2026-03-05') }))];

  it('acepta hoy, el mismo día del último pago y fechas entre ambos', () => {
    expect(() => validatePaymentDate(today, prev, today)).not.toThrow();
    expect(() => validatePaymentDate(d('2026-03-05'), prev, today)).not.toThrow();
    expect(() => validatePaymentDate(d('2026-03-07'), prev, today)).not.toThrow();
    expect(() => validatePaymentDate(d('2020-01-01'), [], today)).not.toThrow();
  });

  it('rechaza una fecha futura', () => {
    expect(() => validatePaymentDate(d('2026-03-11'), prev, today)).toThrow('La fecha del pago no puede ser futura.');
  });

  it('rechaza una fecha anterior al último pago de la tarjeta', () => {
    expect(() => validatePaymentDate(d('2026-03-04'), prev, today)).toThrow('La fecha del pago no puede ser anterior al último pago de esta tarjeta.');
  });

  it('ignora la hora del día', () => {
    expect(() => validatePaymentDate(new Date('2026-03-10T23:59:00Z'), prev, new Date('2026-03-10T01:00:00Z'))).not.toThrow();
  });
});
