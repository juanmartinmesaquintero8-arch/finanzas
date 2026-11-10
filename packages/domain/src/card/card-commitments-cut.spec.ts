import { Money } from '../money/money';
import { CardPurchase } from './card-purchase';
import { cardCommitments, cardFeesDue } from './card-commitments';
import { CreditCard, CreditCardProps } from './credit-card';

const cop = (n: number) => Money.of(n, 'COP');
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const day = (x: Date) => x.toISOString().slice(0, 10);

const fixed = { kind: 'FIXED_MONTHLY' as const, amount: cop(30_000) };
const onMove = { kind: 'ON_MOVEMENT' as const, amount: cop(30_000) };

const card = (o: Partial<CreditCardProps> = {}) =>
  CreditCard.create({ id: 'c1', name: 'Visa', dueDay: 15, paymentAccountId: 'bancolombia', fee: { kind: 'NONE' }, feeStartMonth: '2026-01', ...o });

const purchase = (purchaseDate: string, id = 'p1') =>
  CardPurchase.create({
    id,
    cardId: 'c1',
    description: 'Nevera',
    amount: cop(300),
    installments: 3,
    purchaseDate: d(purchaseDate),
    firstDueDate: d('2030-01-15'),
    monthlyRatePpm: 0,
    paidInstallments: 0,
  });

const pairs = (list: { month: string; dueDate: Date }[]) => list.map((f) => [f.month, day(f.dueDate)]);
const wholeYear = (c: CreditCard, ps: CardPurchase[] = []) => cardFeesDue(c, ps, d('2026-01-01'), d('2027-12-31'));

describe('manejo con día de corte (ciclo de facturación)', () => {
  it('FIXED_MONTHLY: pago mayor que el corte vence el mismo mes del ciclo', () => {
    const list = cardFeesDue(card({ fee: fixed, dueDay: 25, cutDay: 10, feeStartMonth: '2026-03' }), [], d('2026-01-01'), d('2026-05-31'));
    expect(pairs(list)).toEqual([
      ['2026-03', '2026-03-25'],
      ['2026-04', '2026-04-25'],
      ['2026-05', '2026-05-25'],
    ]);
  });

  it('FIXED_MONTHLY: pago menor que el corte vence el mes siguiente', () => {
    const list = cardFeesDue(card({ fee: fixed, dueDay: 5, cutDay: 20, feeStartMonth: '2026-03' }), [], d('2026-01-01'), d('2026-06-30'));
    expect(pairs(list)).toEqual([
      ['2026-03', '2026-04-05'],
      ['2026-04', '2026-05-05'],
      ['2026-05', '2026-06-05'],
    ]);
  });

  it('FIXED_MONTHLY: diciembre a enero y rango por vencimiento', () => {
    const c = card({ fee: fixed, dueDay: 5, cutDay: 20, feeStartMonth: '2026-11' });
    expect(pairs(cardFeesDue(c, [], d('2027-01-01'), d('2027-01-31')))).toEqual([['2026-12', '2027-01-05']]);
  });

  it('ON_MOVEMENT: la compra del día del corte cuenta en el ciclo de ese mes', () => {
    const c = card({ fee: onMove, dueDay: 25, cutDay: 10 });
    expect(pairs(wholeYear(c, [purchase('2026-03-10')]))).toEqual([['2026-03', '2026-03-25']]);
  });

  it('ON_MOVEMENT: la compra del día siguiente al corte cuenta en el ciclo del mes siguiente', () => {
    const c = card({ fee: onMove, dueDay: 25, cutDay: 10 });
    expect(pairs(wholeYear(c, [purchase('2026-03-11')]))).toEqual([['2026-04', '2026-04-25']]);
  });

  it('ON_MOVEMENT: compra después del corte de diciembre cae en el ciclo de enero', () => {
    const c = card({ fee: onMove, dueDay: 25, cutDay: 10 });
    expect(pairs(wholeYear(c, [purchase('2026-12-20')]))).toEqual([['2027-01', '2027-01-25']]);
  });

  it('corte 31 en febrero: la compra del 28 todavía es del ciclo de febrero', () => {
    const c = card({ fee: onMove, dueDay: 5, cutDay: 31 });
    expect(pairs(wholeYear(c, [purchase('2026-02-28')]))).toEqual([['2026-02', '2026-03-05']]);
  });

  it('sin corte nada cambia: la del mes M vence el día de pago de M + 1', () => {
    const ps = [purchase('2026-03-10'), purchase('2026-07-31', 'p2')];
    for (const dueDay of [1, 15, 30, 31]) {
      const fixedList = cardFeesDue(card({ fee: fixed, dueDay }), ps, d('2000-01-01'), d('2027-12-31'));
      const expected: string[][] = [];
      for (let idx = 2026 * 12; idx < 2027 * 12 + 12; idx++) {
        const next = idx + 1;
        const y = Math.floor(next / 12);
        const m = next % 12;
        const due = new Date(Date.UTC(y, m, Math.min(dueDay, new Date(Date.UTC(y, m + 1, 0)).getUTCDate())));
        if (due.getTime() <= d('2027-12-31').getTime()) expected.push([`${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`, day(due)]);
      }
      expect(pairs(fixedList)).toEqual(expected);
      const movement = cardFeesDue(card({ fee: onMove, dueDay }), ps, d('2000-01-01'), d('2027-12-31'));
      expect(movement.map((f) => f.month)).toEqual(['2026-03', '2026-07']);
    }
  });

  it('cardCommitments con corte usa las fechas del ciclo', () => {
    const c = card({ fee: fixed, dueDay: 25, cutDay: 10, feeStartMonth: '2026-03' });
    const out = cardCommitments([c], [], d('2026-01-01'), d('2026-04-30')).filter((x) => x.kind === 'CARD_FEE');
    expect(out.map((x) => day(x.date))).toEqual(['2026-03-25', '2026-04-25']);
  });
});
