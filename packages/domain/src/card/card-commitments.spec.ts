import { Money } from '../money/money';
import { CardPurchase, CardPurchaseProps } from './card-purchase';
import { cardCommitments, cardFeesDue } from './card-commitments';
import { CreditCard, CreditCardProps } from './credit-card';

const cop = (n: number) => Money.of(n, 'COP');
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const day = (x: Date) => x.toISOString().slice(0, 10);

const card = (o: Partial<CreditCardProps> = {}) =>
  CreditCard.create({
    id: 'c1',
    name: 'Visa',
    dueDay: 15,
    paymentAccountId: 'bancolombia',
    fee: { kind: 'NONE' },
    feeStartMonth: '2026-01',
    ...o,
  });

const purchase = (o: Partial<Omit<CardPurchaseProps, 'amount'>> & { amount?: number } = {}) => {
  const { amount = 300, ...rest } = o;
  return CardPurchase.create({
    id: 'p1',
    cardId: 'c1',
    description: 'Nevera',
    amount: cop(amount),
    installments: 3,
    purchaseDate: d('2026-01-10'),
    firstDueDate: d('2026-02-15'),
    monthlyRatePpm: 0,
    paidInstallments: 0,
    ...rest,
  });
};

describe('cardFeesDue', () => {
  it('manejo fijo: la del mes M vence el dueDay de M+1', () => {
    const c = card({ fee: { kind: 'FIXED_MONTHLY', amount: cop(30_000) } });
    const fees = cardFeesDue(c, [], d('2026-03-01'), d('2026-05-31'));
    expect(fees.map((f) => [f.month, day(f.dueDate)])).toEqual([
      ['2026-02', '2026-03-15'],
      ['2026-03', '2026-04-15'],
      ['2026-04', '2026-05-15'],
    ]);
    expect(fees.every((f) => f.amount.amount === 30_000n)).toBe(true);
  });

  it('no cobra antes de feeStartMonth', () => {
    const c = card({ fee: { kind: 'FIXED_MONTHLY', amount: cop(10) }, feeStartMonth: '2026-04' });
    const fees = cardFeesDue(c, [], d('2026-01-01'), d('2026-06-30'));
    expect(fees.map((f) => f.month)).toEqual(['2026-04', '2026-05']);
  });

  it('feeStartMonth en diciembre vence en enero del año siguiente', () => {
    const c = card({ fee: { kind: 'FIXED_MONTHLY', amount: cop(10) }, feeStartMonth: '2026-12' });
    const fees = cardFeesDue(c, [], d('2026-01-01'), d('2027-02-28'));
    expect(fees.map((f) => [f.month, day(f.dueDate)])).toEqual([
      ['2026-12', '2027-01-15'],
      ['2027-01', '2027-02-15'],
    ]);
  });

  it('feesSettledThrough excluye ese mes y los anteriores', () => {
    const c = card({ fee: { kind: 'FIXED_MONTHLY', amount: cop(10) }, feesSettledThrough: '2026-03' });
    const fees = cardFeesDue(c, [], d('2026-01-01'), d('2026-06-30'));
    expect(fees.map((f) => f.month)).toEqual(['2026-04', '2026-05']);
  });

  it('dueDay 31 se ajusta a fin de mes', () => {
    const c = card({ dueDay: 31, fee: { kind: 'FIXED_MONTHLY', amount: cop(10) }, feeStartMonth: '2026-01' });
    const fees = cardFeesDue(c, [], d('2026-01-01'), d('2026-05-31'));
    expect(fees.map((f) => day(f.dueDate))).toEqual(['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  });

  it('sin manejo no genera nada', () => {
    expect(cardFeesDue(card(), [], d('2026-01-01'), d('2026-12-31'))).toEqual([]);
  });

  it('con movimiento: solo los meses con una compra de esta tarjeta, una vez por mes', () => {
    const c = card({ fee: { kind: 'ON_MOVEMENT', amount: cop(25_000) }, feeStartMonth: '2026-01' });
    const ps = [
      purchase({ id: 'a', purchaseDate: d('2026-01-10') }),
      purchase({ id: 'b', purchaseDate: d('2026-01-20') }),
      purchase({ id: 'c', purchaseDate: d('2026-03-02'), firstDueDate: d('2026-04-15') }),
      purchase({ id: 'x', cardId: 'otra', purchaseDate: d('2026-02-02'), firstDueDate: d('2026-03-15') }),
    ];
    const fees = cardFeesDue(c, ps, d('2026-01-01'), d('2026-12-31'));
    expect(fees.map((f) => [f.month, day(f.dueDate), f.amount.amount])).toEqual([
      ['2026-01', '2026-02-15', 25_000n],
      ['2026-03', '2026-04-15', 25_000n],
    ]);
  });

  it('con movimiento: una compra futura genera su mes; meses futuros sin compra no', () => {
    const c = card({ fee: { kind: 'ON_MOVEMENT', amount: cop(25_000) } });
    const fees = cardFeesDue(c, [purchase({ purchaseDate: d('2026-08-05'), firstDueDate: d('2026-09-15') })], d('2026-06-01'), d('2026-12-31'));
    expect(fees.map((f) => f.month)).toEqual(['2026-08']);
  });

  it('con movimiento: el pago de cuotas no es movimiento (una compra vieja no cobra meses posteriores)', () => {
    const c = card({ fee: { kind: 'ON_MOVEMENT', amount: cop(25_000) } });
    const fees = cardFeesDue(c, [purchase({ purchaseDate: d('2026-01-10'), installments: 12 })], d('2026-03-01'), d('2026-12-31'));
    expect(fees.map((f) => f.month)).toEqual([]);
  });

  it('con movimiento respeta feeStartMonth y feesSettledThrough', () => {
    const c = card({ fee: { kind: 'ON_MOVEMENT', amount: cop(1) }, feeStartMonth: '2026-02', feesSettledThrough: '2026-04' });
    const ps = ['2026-01-05', '2026-02-05', '2026-04-05', '2026-05-05'].map((s, i) => purchase({ id: `p${i}`, purchaseDate: d(s), firstDueDate: d('2026-12-15') }));
    const fees = cardFeesDue(c, ps, d('2026-01-01'), d('2026-12-31'));
    expect(fees.map((f) => f.month)).toEqual(['2026-05']);
  });

  it('el rango [from, to] es inclusivo por fecha de vencimiento', () => {
    const c = card({ fee: { kind: 'FIXED_MONTHLY', amount: cop(10) } });
    const fees = cardFeesDue(c, [], d('2026-03-15'), d('2026-04-15'));
    expect(fees.map((f) => day(f.dueDate))).toEqual(['2026-03-15', '2026-04-15']);
  });
});

describe('cardCommitments', () => {
  it('cuotas no pagadas de compras abiertas, con tope en to', () => {
    const c = card();
    const p = purchase({ paidInstallments: 1 });
    const out = cardCommitments([c], [p], d('2026-01-01'), d('2026-03-31'));
    expect(out).toHaveLength(1);
    expect(day(out[0].date)).toBe('2026-03-15');
    expect(out[0].amount.amount).toBe(100n);
    expect(out[0].kind).toBe('CARD_INSTALLMENT');
    expect(out[0].accountId).toBe('bancolombia');
    expect(out[0].scheduledExpenseId).toBe('p1');
    expect(out[0].description).toContain('Nevera');
    expect(out[0].description).toContain('2/3');
  });

  it('excluye compras cerradas y cuotas pagadas', () => {
    const c = card();
    const closed = purchase({ id: 'pc' }).close(d('2026-02-01'));
    const paid = purchase({ id: 'pp', paidInstallments: 3 });
    expect(cardCommitments([c], [closed, paid], d('2026-01-01'), d('2026-12-31'))).toEqual([]);
  });

  it('las vencidas antes de from se fijan en from', () => {
    const c = card();
    const out = cardCommitments([c], [purchase()], d('2026-03-01'), d('2026-03-31'));
    expect(out.map((o) => [day(o.date), o.description.match(/\d\/3/)![0]])).toEqual([
      ['2026-03-01', '1/3'],
      ['2026-03-15', '2/3'],
    ]);
  });

  it('suma interés a la cuota', () => {
    const out = cardCommitments([card()], [purchase({ amount: 300, monthlyRatePpm: 100_000 })], d('2026-01-01'), d('2026-02-28'));
    expect(out[0].amount.amount).toBe(130n); // capital 100 + 10 % de 300
  });

  it('cuotas de manejo vencidas antes de from y las que vencen hasta to', () => {
    const c = card({ fee: { kind: 'FIXED_MONTHLY', amount: cop(10) }, feeStartMonth: '2026-01', feesSettledThrough: '2026-01' });
    const out = cardCommitments([c], [], d('2026-04-01'), d('2026-05-31'));
    const fees = out.filter((o) => o.kind === 'CARD_FEE');
    expect(fees.map((f) => day(f.date))).toEqual(['2026-04-01', '2026-04-15', '2026-05-15']);
    expect(fees.every((f) => f.accountId === 'bancolombia' && f.amount.amount === 10n)).toBe(true);
  });

  it('ordenadas por fecha; ignora compras de tarjetas desconocidas', () => {
    const c = card({ fee: { kind: 'FIXED_MONTHLY', amount: cop(10) } });
    const p = purchase();
    const huerfana = purchase({ id: 'h', cardId: 'zzz' });
    const out = cardCommitments([c], [p, huerfana], d('2026-02-01'), d('2026-04-30'));
    const times = out.map((o) => o.date.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(out.some((o) => o.scheduledExpenseId === 'h')).toBe(false);
  });
});
