import { Money } from '../money/money';
import { CardPurchase, CardPurchaseProps } from './card-purchase';
import { Allocation, CardPayment, createCardPayment } from './card-payment';
import { cardCommitments } from './card-commitments';
import { cardCommitmentsWithPayments, cardDebtWithPayments, cardDue, maxPayment, nextPaymentDate } from './card-due';
import { CreditCard, CreditCardProps } from './credit-card';
import { cardDebt, firstDueDateFor } from './installments';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const cop = (n: bigint | number) => Money.of(n, 'COP');
const card = (o: Partial<CreditCardProps> = {}) =>
  CreditCard.create({ id: 'c1', name: 'Visa', dueDay: 15, paymentAccountId: 'a1', fee: { kind: 'NONE' }, feeStartMonth: '2026-01', ...o });
const make = (o: Partial<Omit<CardPurchaseProps, 'amount'>> & { amount?: bigint | number } = {}) => {
  const { amount = 1_200_000, ...rest } = o;
  return CardPurchase.create({
    id: 'p1',
    cardId: 'c1',
    description: 'Compra',
    amount: Money.of(amount, 'COP'),
    installments: 12,
    purchaseDate: d('2026-01-10'),
    firstDueDate: d('2026-02-15'),
    monthlyRatePpm: 20_000,
    paidInstallments: 0,
    ...rest,
  });
};
const inst = (number: number, interest: number, capital: number, purchaseId = 'p1'): Allocation => ({
  kind: 'INSTALLMENT',
  purchaseId,
  number,
  interest: cop(interest),
  capital: cop(capital),
});
const pay = (seq: number, paidOn: Date, allocations: Allocation[], cardId = 'c1'): CardPayment =>
  createCardPayment({
    id: `pay${seq}`,
    cardId,
    seq,
    paidOn,
    fromAccountId: 'a1',
    total: cop(allocations.reduce((a, x) => a + (x.kind === 'INSTALLMENT' ? x.interest.amount + x.capital.amount : x.kind === 'EXTRA' ? x.capital.amount : x.amount.amount), 0n)),
    allocations,
    extraMode: allocations.some((a) => a.kind === 'EXTRA') ? 'SHORTEN' : undefined,
    transactionIds: [],
  });
const view = (items: ReturnType<typeof cardDue>) =>
  items.map((i) => [i.kind, i.purchaseId ?? i.month, i.number ?? null, i.dueDate.toISOString().slice(0, 10), i.amount.amount, i.overdue]);

describe('nextPaymentDate', () => {
  it('el día de pago de este mes si no ha pasado (hoy incluido); si no, el del siguiente, ajustado a fin de mes', () => {
    expect(nextPaymentDate(d('2026-03-01'), 15)).toEqual(d('2026-03-15'));
    expect(nextPaymentDate(d('2026-03-15'), 15)).toEqual(d('2026-03-15'));
    expect(nextPaymentDate(d('2026-03-16'), 15)).toEqual(d('2026-04-15'));
    expect(nextPaymentDate(d('2026-02-10'), 31)).toEqual(d('2026-02-28'));
  });
});

describe('cardDue', () => {
  it('sin pagos: lo vencido y lo del periodo, cada parte por separado', () => {
    expect(view(cardDue(card(), [make()], [], d('2026-03-01')))).toEqual([
      ['INTEREST', 'p1', 1, '2026-02-15', 24_000n, true],
      ['CAPITAL', 'p1', 1, '2026-02-15', 100_000n, true],
      // Sin pagos nuevos nada cambia frente al plan (la cuota 1 se supone pagada a tiempo).
      ['INTEREST', 'p1', 2, '2026-03-15', 22_000n, false],
      ['CAPITAL', 'p1', 2, '2026-03-15', 100_000n, false],
    ]);
  });

  it('pago parcial: lo que falta queda vencido y la cuota siguiente cobra interés por ello', () => {
    const p1 = pay(1, d('2026-02-15'), [inst(1, 24_000, 36_000)]);
    expect(view(cardDue(card(), [make()], [p1], d('2026-03-01')))).toEqual([
      ['CAPITAL', 'p1', 1, '2026-02-15', 64_000n, true],
      ['INTEREST', 'p1', 2, '2026-03-15', 23_280n, false],
      ['CAPITAL', 'p1', 2, '2026-03-15', 100_000n, false],
    ]);
  });

  it('el día del vencimiento la cuota es del periodo, no vencida', () => {
    expect(view(cardDue(card(), [make()], [], d('2026-02-15')))).toEqual([
      ['INTEREST', 'p1', 1, '2026-02-15', 24_000n, false],
      ['CAPITAL', 'p1', 1, '2026-02-15', 100_000n, false],
    ]);
  });

  it('manejo: vencido y del periodo, restando lo pagado y feesSettledThrough', () => {
    const fee = card({ fee: { kind: 'FIXED_MONTHLY', amount: cop(26_000) } });
    const items = cardDue(fee, [], [], d('2026-03-01'));
    expect(view(items)).toEqual([
      ['FEE', '2026-01', null, '2026-02-15', 26_000n, true],
      ['FEE', '2026-02', null, '2026-03-15', 26_000n, false],
    ]);
    const partial = pay(1, d('2026-02-15'), [{ kind: 'FEE', month: '2026-01', amount: cop(20_000) }]);
    expect(view(cardDue(fee, [], [partial], d('2026-03-01')))[0]).toEqual(['FEE', '2026-01', null, '2026-02-15', 6_000n, true]);
    const full = pay(1, d('2026-02-15'), [{ kind: 'FEE', month: '2026-01', amount: cop(26_000) }]);
    expect(view(cardDue(fee, [], [full], d('2026-03-01')))).toHaveLength(1);
    const settled = card({ fee: { kind: 'FIXED_MONTHLY', amount: cop(26_000) }, feesSettledThrough: '2026-01' });
    expect(view(cardDue(settled, [], [], d('2026-03-01')))).toHaveLength(1);
  });

  it('con corte: nada se cobra antes del corte; después del corte, la cuota del extracto', () => {
    const cut = card({ dueDay: 5, cutDay: 20 });
    const purchase = make({ firstDueDate: firstDueDateFor(d('2026-01-10'), 5, 20), dueDayAnchor: 5 });
    expect(cardDue(cut, [purchase], [], d('2026-01-15'))).toEqual([]);
    expect(maxPayment(cut, [purchase], [], d('2026-01-15')).amount).toBe(1_200_000n);
    expect(view(cardDue(cut, [purchase], [], d('2026-01-21')))).toEqual([
      ['INTEREST', 'p1', 1, '2026-02-05', 24_000n, false],
      ['CAPITAL', 'p1', 1, '2026-02-05', 100_000n, false],
    ]);
    // Pagada la cuota 1, entre el pago y el corte siguiente no hay nada por pagar.
    const paid = pay(1, d('2026-02-05'), [inst(1, 24_000, 100_000)]);
    expect(cardDue(cut, [purchase], [paid], d('2026-02-10'))).toEqual([]);
    expect(view(cardDue(cut, [purchase], [paid], d('2026-02-21')))).toEqual([
      ['INTEREST', 'p1', 2, '2026-03-05', 22_000n, false],
      ['CAPITAL', 'p1', 2, '2026-03-05', 100_000n, false],
    ]);
  });

  it('cuotas heredadas pagadas y compras cerradas; otras tarjetas no cuentan', () => {
    const inherited = make({ paidInstallments: 3 });
    const closed = make({ id: 'p2', paidInstallments: 1 }).close(d('2026-03-01'));
    const other = make({ id: 'p3', cardId: 'c2' });
    expect(view(cardDue(card(), [inherited, closed, other], [], d('2026-05-01')))).toEqual([
      ['INTEREST', 'p1', 4, '2026-05-15', 18_000n, false],
      ['CAPITAL', 'p1', 4, '2026-05-15', 100_000n, false],
    ]);
  });
});

describe('R3: desde el primer pago de la tarjeta, lo no pagado cuenta en el interés', () => {
  const other = make({ id: 'p2', amount: 100_000, installments: 1, monthlyRatePpm: 0, purchaseDate: d('2026-01-05') });
  const first = pay(1, d('2026-02-10'), [inst(1, 0, 100_000, 'p2')]);
  const interest2 = (pays: CardPayment[]) =>
    cardDue(card(), [make(), other], pays, d('2026-03-01')).find((i) => i.purchaseId === 'p1' && i.number === 2 && i.kind === 'INTEREST')!.amount.amount;

  it('sin eventos, como hoy (22.000); con un evento y sin pagar la cuota 1, 24.000; pagando 60.000, 23.280', () => {
    expect(interest2([])).toBe(22_000n);
    expect(interest2([first])).toBe(24_000n);
    expect(interest2([first, pay(2, d('2026-02-10'), [inst(1, 24_000, 36_000)])])).toBe(23_280n);
  });
});

describe('maxPayment', () => {
  it('lo vencido y del periodo más el capital pendiente: igual que liquidar hoy', () => {
    const p1 = pay(1, d('2026-02-15'), [inst(1, 24_000, 36_000)]);
    // Capital 1.164.000 + interés de la cuota 2 (23.280).
    expect(maxPayment(card(), [make()], [p1], d('2026-03-01')).amount).toBe(1_187_280n);
  });
  it('incluye el manejo y nada de compras cerradas', () => {
    const fee = card({ fee: { kind: 'FIXED_MONTHLY', amount: cop(26_000) } });
    expect(maxPayment(fee, [make().close(d('2026-01-20'))], [], d('2026-03-01')).amount).toBe(52_000n);
  });
});

describe('cardDebtWithPayments', () => {
  it('sin pagos es igual a cardDebt', () => {
    const ps = [make(), make({ id: 'p2', paidInstallments: 5 }), make({ id: 'p3', paidInstallments: 2 }).close(d('2026-05-01'))];
    expect(cardDebtWithPayments([card()], ps, []).amount).toBe(cardDebt(ps).amount);
  });
  it('resta el capital realmente pagado, también la plata de más', () => {
    const p1 = pay(1, d('2026-02-15'), [inst(1, 24_000, 100_000), { kind: 'EXTRA', purchaseId: 'p1', capital: cop(10_000) }]);
    expect(cardDebtWithPayments([card()], [make()], [p1]).amount).toBe(1_090_000n);
    const partial = pay(1, d('2026-02-15'), [inst(1, 24_000, 36_000)]);
    expect(cardDebtWithPayments([card()], [make()], [partial]).amount).toBe(1_164_000n);
  });
  it('usa el corte de la tarjeta (parcial y luego pago completo en una tarjeta con corte)', () => {
    const cut = card({ dueDay: 5, cutDay: 20 });
    const purchase = make({ firstDueDate: firstDueDateFor(d('2026-01-10'), 5, 20), dueDayAnchor: 5 });
    const a = pay(1, d('2026-02-10'), [inst(1, 24_000, 36_000)]);
    expect(view(cardDue(cut, [purchase], [a], d('2026-02-25')))).toEqual([
      ['CAPITAL', 'p1', 1, '2026-02-05', 64_000n, true],
      ['INTEREST', 'p1', 2, '2026-03-05', 23_280n, false],
      ['CAPITAL', 'p1', 2, '2026-03-05', 100_000n, false],
    ]);
    const b = pay(2, d('2026-02-25'), [inst(1, 0, 64_000), inst(2, 23_280, 100_000)]);
    expect(cardDebtWithPayments([cut], [purchase], [a, b]).amount).toBe(1_000_000n);
  });

  it('sin compras: cero en la moneda dada', () => {
    expect(cardDebtWithPayments([], [], []).equals(Money.zero('COP'))).toBe(true);
  });
});

describe('cardCommitmentsWithPayments', () => {
  const cards = [
    card({ fee: { kind: 'FIXED_MONTHLY', amount: cop(26_000) } }),
    card({ id: 'c2', name: 'Master', dueDay: 5, cutDay: 20, fee: { kind: 'ON_MOVEMENT', amount: cop(15_000) } }),
  ];
  const purchases = [
    make(),
    make({ id: 'p2', paidInstallments: 4, amount: 1_000_003, installments: 7 }),
    make({ id: 'p3', paidInstallments: 1 }).close(d('2026-03-01')),
    make({ id: 'p4', cardId: 'c2', purchaseDate: d('2026-01-20'), firstDueDate: firstDueDateFor(d('2026-01-20'), 5, 20), installments: 36, monthlyRatePpm: 0 }),
  ];

  it('sin pagos es idéntico a cardCommitments', () => {
    for (const [from, to] of [
      ['2026-01-01', '2026-12-31'],
      ['2026-04-10', '2027-06-30'],
      ['2026-02-15', '2026-02-15'],
    ]) {
      expect(cardCommitmentsWithPayments(cards, purchases, [], d(from), d(to))).toEqual(cardCommitments(cards, purchases, d(from), d(to)));
    }
  });

  it('usa lo que falta de cada cuota y deja lo vencido en `from`', () => {
    const p1 = pay(1, d('2026-02-15'), [inst(1, 24_000, 36_000), { kind: 'FEE', month: '2026-01', amount: cop(26_000) }]);
    const out = cardCommitmentsWithPayments(cards.slice(0, 1), [make()], [p1], d('2026-03-01'), d('2026-03-31'));
    expect(out.map((c) => [c.kind, c.date.toISOString().slice(0, 10), c.amount.amount, c.description])).toEqual([
      ['CARD_INSTALLMENT', '2026-03-01', 64_000n, 'Compra (cuota 1/12)'],
      ['CARD_INSTALLMENT', '2026-03-15', 123_280n, 'Compra (cuota 2/12)'],
      ['CARD_FEE', '2026-03-15', 26_000n, 'Manejo Visa (febrero 2026)'],
    ]);
  });

  it('pagos de otra tarjeta no cambian nada', () => {
    const elsewhere = pay(1, d('2026-02-15'), [{ kind: 'FEE', month: '2026-01', amount: cop(26_000) }], 'c9');
    expect(cardCommitmentsWithPayments(cards, purchases, [elsewhere], d('2026-01-01'), d('2026-06-30'))).toEqual(
      cardCommitments(cards, purchases, d('2026-01-01'), d('2026-06-30')),
    );
  });
});
