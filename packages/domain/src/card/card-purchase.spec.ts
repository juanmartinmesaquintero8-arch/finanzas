import { Money } from '../money/money';
import { DomainValidationError } from '../shared/domain-validation.error';
import { CardPurchase } from './card-purchase';

const cop = (n: number) => Money.of(n, 'COP');
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const base = {
  id: 'p1',
  cardId: 'c1',
  description: ' Nevera ',
  amount: cop(1_200_000),
  installments: 12,
  purchaseDate: d('2026-11-08'),
  firstDueDate: d('2026-12-15'),
  monthlyRatePpm: 20_000,
  paidInstallments: 0,
};

describe('CardPurchase', () => {
  it('crea una compra válida', () => {
    const p = CardPurchase.create({ ...base, category: ' Hogar ' });
    expect(p.description).toBe('Nevera');
    expect(p.category).toBe('Hogar');
    expect(p.paidInstallments).toBe(0);
    expect(p.closedOn).toBeUndefined();
    expect(p.isClosed).toBe(false);
  });

  it('exige descripción, monto positivo y fechas válidas', () => {
    expect(() => CardPurchase.create({ ...base, description: ' ' })).toThrow(DomainValidationError);
    expect(() => CardPurchase.create({ ...base, amount: cop(0) })).toThrow(DomainValidationError);
    expect(() => CardPurchase.create({ ...base, amount: cop(-1) })).toThrow(DomainValidationError);
    expect(() => CardPurchase.create({ ...base, purchaseDate: new Date('x') })).toThrow(DomainValidationError);
  });

  it.each([0, 73, 1.5, -2, Number.NaN])('rechaza %s cuotas', (installments) => {
    expect(() => CardPurchase.create({ ...base, installments })).toThrow(DomainValidationError);
  });

  it('acepta 1 y 72 cuotas', () => {
    expect(CardPurchase.create({ ...base, installments: 1 }).installments).toBe(1);
    expect(CardPurchase.create({ ...base, installments: 72 }).installments).toBe(72);
  });

  it('la primera cuota no puede ser anterior a la compra, pero sí el mismo día', () => {
    expect(() => CardPurchase.create({ ...base, firstDueDate: d('2026-11-07') })).toThrow(DomainValidationError);
    expect(CardPurchase.create({ ...base, firstDueDate: d('2026-11-08') }).firstDueDate).toEqual(d('2026-11-08'));
  });

  it.each([-1, 1.5, Number.NaN])('rechaza tasa mensual %s', (monthlyRatePpm) => {
    expect(() => CardPurchase.create({ ...base, monthlyRatePpm })).toThrow(DomainValidationError);
  });

  it('acepta tasa 0 (sin interés)', () => {
    expect(CardPurchase.create({ ...base, monthlyRatePpm: 0 }).monthlyRatePpm).toBe(0);
  });

  it('las cuotas pagadas van de 0 a installments', () => {
    expect(() => CardPurchase.create({ ...base, paidInstallments: -1 })).toThrow(DomainValidationError);
    expect(() => CardPurchase.create({ ...base, paidInstallments: 13 })).toThrow(DomainValidationError);
    expect(() => CardPurchase.create({ ...base, paidInstallments: 1.5 })).toThrow(DomainValidationError);
    expect(CardPurchase.create({ ...base, paidInstallments: 12 }).paidInstallments).toBe(12);
  });

  it('markPaid avanza hasta la cuota indicada y es repetible', () => {
    const p = CardPurchase.create(base);
    const q = p.markPaid(3);
    expect(q.paidInstallments).toBe(3);
    expect(p.paidInstallments).toBe(0);
    expect(q.markPaid(3).paidInstallments).toBe(3);
    expect(q.markPaid(12).paidInstallments).toBe(12);
  });

  it('markPaid no retrocede ni se pasa de installments', () => {
    const p = CardPurchase.create({ ...base, paidInstallments: 5 });
    expect(() => p.markPaid(4)).toThrow(DomainValidationError);
    expect(() => p.markPaid(13)).toThrow(DomainValidationError);
    expect(() => p.markPaid(6.5)).toThrow(DomainValidationError);
  });

  it('undoLastPayment resta una cuota y en 0 no hace nada', () => {
    const p = CardPurchase.create({ ...base, paidInstallments: 2 });
    expect(p.undoLastPayment().paidInstallments).toBe(1);
    const zero = CardPurchase.create(base);
    expect(zero.undoLastPayment().paidInstallments).toBe(0);
    expect(zero.undoLastPayment()).toBe(zero);
  });

  it('close marca la fecha de cierre y no se puede pagar después', () => {
    const p = CardPurchase.create(base).close(d('2026-12-01'));
    expect(p.closedOn).toEqual(d('2026-12-01'));
    expect(p.isClosed).toBe(true);
    expect(() => p.markPaid(1)).toThrow(DomainValidationError);
    expect(() => CardPurchase.create(base).close(new Date('x'))).toThrow(DomainValidationError);
  });

  it('toProps devuelve lo necesario para recrearla', () => {
    const p = CardPurchase.create({ ...base, paidInstallments: 2, category: 'Hogar' });
    expect(CardPurchase.create(p.toProps()).toProps()).toEqual(p.toProps());
  });
});
