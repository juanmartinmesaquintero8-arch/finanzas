import { Money } from '../money/money';
import { addDaysUTC } from '../shared/date';
import { CardPurchase, CardPurchaseProps } from './card-purchase';
import { Allocation, CardPayment, createCardPayment, ExtraMode } from './card-payment';
import { cardCommitmentsWithPayments, cardDebtWithPayments, cardDue, maxPayment, purchaseBalances } from './card-due';
import { CreditCard, CreditCardProps } from './credit-card';
import { firstDueDateFor } from './installments';
import { allocatePayment, paymentPreview } from './payment-allocation';
import { computeSchedule } from './purchase-schedule';

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
type Flat = [string, string, number | null, bigint, bigint?];
const flat = (xs: readonly Allocation[]): Flat[] =>
  xs.map((a) =>
    a.kind === 'INSTALLMENT'
      ? ['INSTALLMENT', a.purchaseId, a.number, a.interest.amount, a.capital.amount]
      : a.kind === 'EXTRA'
        ? ['EXTRA', a.purchaseId, null, a.capital.amount]
        : ['FEE', a.month, null, a.amount.amount],
  );
const allocate = (c: CreditCard, ps: CardPurchase[], pays: CardPayment[], on: Date, amount: bigint | number, extraPurchaseId?: string) =>
  allocatePayment(cardDue(c, ps, pays, on), cop(amount), { extraPurchaseId, purchases: purchaseBalances(c, ps, pays, on) });

// Tarjeta con manejo de 26.000. p1: 1.200.000 a 12 cuotas al 2 %. p2: 600.000 a 6 cuotas al 3 %, comprada después.
const feeCard = card({ fee: { kind: 'FIXED_MONTHLY', amount: cop(26_000) } });
const p1 = make();
const p2 = make({ id: 'p2', amount: 600_000, installments: 6, monthlyRatePpm: 30_000, purchaseDate: d('2026-01-12') });
const on = d('2026-03-01');
// Al 1 de marzo, sin pagos: vencido el 15 feb y del periodo el 15 mar.
// Vencido: manejo 26.000; interés 24.000 y 18.000; capital 100.000 y 100.000. Periodo: lo mismo (interés 22.000 y 15.000).
const dueTotal = 26_000 + 24_000 + 18_000 + 100_000 + 100_000 + 26_000 + 22_000 + 15_000 + 100_000 + 100_000;

describe('allocatePayment: orden', () => {
  it('lo vencido primero; en la misma fecha manejo, interés, capital; la compra más antigua primero', () => {
    expect(flat(allocate(feeCard, [p2, p1], [], on, 100_000))).toEqual([
      ['FEE', '2026-01', null, 26_000n],
      ['INSTALLMENT', 'p1', 1, 24_000n, 32_000n],
      ['INSTALLMENT', 'p2', 1, 18_000n, 0n],
    ]);
  });

  it('cubre todo lo vencido antes de lo del periodo', () => {
    const vencido = 26_000 + 24_000 + 18_000 + 100_000 + 100_000;
    expect(flat(allocate(feeCard, [p1, p2], [], on, vencido + 30_000))).toEqual([
      ['FEE', '2026-01', null, 26_000n],
      ['INSTALLMENT', 'p1', 1, 24_000n, 100_000n],
      ['INSTALLMENT', 'p2', 1, 18_000n, 100_000n],
      ['FEE', '2026-02', null, 26_000n],
      ['INSTALLMENT', 'p1', 2, 4_000n, 0n],
    ]);
  });

  it('en empate de fecha de compra decide el id', () => {
    const a = make({ id: 'b', amount: 100_000, installments: 1 });
    const b = make({ id: 'a', amount: 100_000, installments: 1 });
    expect(flat(allocate(card(), [a, b], [], d('2026-02-01'), 3_000))).toEqual([
      ['INSTALLMENT', 'a', 1, 2_000n, 0n],
      ['INSTALLMENT', 'b', 1, 1_000n, 0n],
    ]);
  });

  it('tasa 0: la cuota es solo capital', () => {
    const zero = make({ id: 'z', monthlyRatePpm: 0, amount: 300, installments: 3 });
    expect(flat(allocate(card(), [zero], [], d('2026-02-01'), 50))).toEqual([['INSTALLMENT', 'z', 1, 0n, 50n]]);
  });
});

describe('allocatePayment: plata de más', () => {
  it('va a la compra de mayor tasa; si la cierra, el resto pasa a la siguiente', () => {
    // Capital fuera de lo debido: p2 400.000, p1 1.000.000.
    const out = flat(allocate(feeCard, [p1, p2], [], on, dueTotal + 450_000));
    expect(out.slice(-2)).toEqual([
      ['EXTRA', 'p2', null, 400_000n],
      ['EXTRA', 'p1', null, 50_000n],
    ]);
  });

  it('extraPurchaseId manda', () => {
    expect(flat(allocate(feeCard, [p1, p2], [], on, dueTotal + 450_000, 'p1')).slice(-1)).toEqual([['EXTRA', 'p1', null, 450_000n]]);
    expect(flat(allocate(feeCard, [p1, p2], [], on, dueTotal + 1_100_000, 'p1')).slice(-2)).toEqual([
      ['EXTRA', 'p1', null, 1_000_000n],
      ['EXTRA', 'p2', null, 100_000n],
    ]);
  });

  it('las compras de 0 % van al final aunque sean más antiguas; entre iguales, la más antigua', () => {
    const zeroOld = make({ id: 'z', monthlyRatePpm: 0, purchaseDate: d('2026-01-01'), amount: 1_000_000, installments: 10 });
    const sameRateNewer = make({ id: 'p0', purchaseDate: d('2026-01-11') });
    // Lo debido el 1 feb: 100.000 + (24.000 + 100.000) × 2 = 348.000. Capital aparte: z 900.000, p0 y p1 1.100.000.
    const out = flat(allocate(card(), [zeroOld, sameRateNewer, p1], [], d('2026-02-01'), 348_000 + 2_200_005));
    expect(out.slice(-3)).toEqual([
      ['EXTRA', 'p1', null, 1_100_000n],
      ['EXTRA', 'p0', null, 1_100_000n],
      ['EXTRA', 'z', null, 5n],
    ]);
  });

  it('rechaza una compra elegida que no es de la tarjeta', () => {
    expect(() => allocate(feeCard, [p1, p2], [], on, dueTotal + 1, 'nope')).toThrow('La compra elegida no está en esta tarjeta.');
  });
});

describe('allocatePayment: límites', () => {
  it('pagar 0 o menos se rechaza', () => {
    expect(() => allocate(feeCard, [p1], [], on, 0)).toThrow('El pago debe ser mayor que cero.');
    expect(() => allocate(feeCard, [p1], [], on, -5)).toThrow('El pago debe ser mayor que cero.');
  });
  it('pagar exactamente lo debido no deja plata de más', () => {
    const out = allocate(feeCard, [p1, p2], [], on, dueTotal);
    expect(out.some((a) => a.kind === 'EXTRA')).toBe(false);
    expect(out.reduce((a, x) => a + (x.kind === 'INSTALLMENT' ? x.interest.amount + x.capital.amount : x.kind === 'FEE' ? x.amount.amount : 0n), 0n)).toBe(BigInt(dueTotal));
  });
  it('pagar el máximo se acepta y uno más se rechaza con el máximo', () => {
    const max = maxPayment(feeCard, [p1, p2], [], on).amount;
    expect(max).toBe(BigInt(dueTotal) + 1_400_000n);
    expect(() => allocate(feeCard, [p1, p2], [], on, max)).not.toThrow();
    expect(() => allocate(feeCard, [p1, p2], [], on, max + 1n)).toThrow('El máximo que puedes pagar es $1.931.000.');
  });
  it('pagar el máximo deja la tarjeta sin deuda', () => {
    const max = maxPayment(feeCard, [p1, p2], [], on);
    const allocations = allocate(feeCard, [p1, p2], [], on, max.amount);
    const payment = createCardPayment({ id: 'x', cardId: 'c1', seq: 1, paidOn: on, fromAccountId: 'a1', total: max, allocations, extraMode: 'SHORTEN', transactionIds: [] });
    expect(cardDebtWithPayments([feeCard], [p1, p2], [payment]).amount).toBe(0n);
    expect(cardDue(feeCard, [p1, p2], [payment], on)).toEqual([]);
    expect(maxPayment(feeCard, [p1, p2], [payment], on).amount).toBe(0n);
  });
  it('montos mayores que Number.MAX_SAFE_INTEGER', () => {
    const big = make({ amount: 10n ** 20n + 7n, installments: 72 });
    const max = maxPayment(card(), [big], [], d('2026-02-01')).amount;
    const out = allocate(card(), [big], [], d('2026-02-01'), max);
    expect(out.reduce((a, x) => a + (x.kind === 'INSTALLMENT' ? x.interest.amount + x.capital.amount : x.kind === 'EXTRA' ? x.capital.amount : 0n), 0n)).toBe(max);
  });
});

describe('paymentPreview', () => {
  it('agrupa por compra y manejo y muestra cómo queda con SHORTEN y con LOWER', () => {
    // Mismo caso que purchaseSchedule: parcial el 15 feb, cierre de la cuota 1 el 1 mar, 500.000 el 10 mar.
    const pay = (seq: number, paidOn: string, allocations: Allocation[]) =>
      createCardPayment({
        id: `p${seq}`,
        cardId: 'c1',
        seq,
        paidOn: d(paidOn),
        fromAccountId: 'a1',
        total: cop(allocations.reduce((a, x) => a + (x.kind === 'INSTALLMENT' ? x.interest.amount + x.capital.amount : 0n), 0n)),
        allocations,
        transactionIds: [],
      });
    const pays = [
      pay(1, '2026-02-15', [{ kind: 'INSTALLMENT', purchaseId: 'p1', number: 1, interest: cop(24_000), capital: cop(36_000) }]),
      pay(2, '2026-03-01', [
        { kind: 'INSTALLMENT', purchaseId: 'p1', number: 1, interest: cop(0), capital: cop(64_000) },
        { kind: 'INSTALLMENT', purchaseId: 'p1', number: 2, interest: cop(23_280), capital: cop(12_720) },
      ]),
    ];
    const preview = paymentPreview(card(), [p1], pays, d('2026-03-10'), cop(500_000));
    expect(flat(preview.allocations)).toEqual([
      ['INSTALLMENT', 'p1', 2, 0n, 87_280n],
      ['EXTRA', 'p1', null, 412_720n],
    ]);
    expect(preview.fees).toEqual([]);
    expect(preview.purchases.map((p) => [p.purchaseId, p.interest.amount, p.capital.amount, p.extraCapital.amount])).toEqual([['p1', 0n, 87_280n, 412_720n]]);
    expect(preview.extraCapital.amount).toBe(412_720n);
    expect(preview.outcomes).toHaveLength(1);
    const o = preview.outcomes[0];
    expect(o.purchaseId).toBe('p1');
    expect(o.SHORTEN.remainingInstallments).toBe(6);
    expect(o.SHORTEN.nextInstallment.amount).toBe(111_746n);
    expect(o.LOWER.remainingInstallments).toBe(10);
    expect(o.LOWER.nextInstallment.amount).toBe(70_474n);
    // La última cuota que quedaría: terminar antes acorta el plan; bajar la cuota lo deja igual.
    expect(o.SHORTEN.lastDueDate).toEqual(d('2026-09-15'));
    expect(o.LOWER.lastDueDate).toEqual(d('2027-01-15'));
  });

  it('si la plata de más cierra la compra no queda última cuota', () => {
    const all = maxPayment(card(), [p1], [], on);
    const [o] = paymentPreview(card(), [p1], [], on, all).outcomes;
    expect(o.SHORTEN).toEqual({ remainingInstallments: 0, nextInstallment: cop(0), lastDueDate: null });
    expect(o.LOWER).toEqual({ remainingInstallments: 0, nextInstallment: cop(0), lastDueDate: null });
  });

  it('sin plata de más no hay opciones; el manejo va aparte', () => {
    const preview = paymentPreview(feeCard, [p1, p2], [], on, cop(100_000));
    expect(preview.extraCapital.amount).toBe(0n);
    expect(preview.outcomes).toEqual([]);
    expect(preview.fees.map((f) => [f.month, f.amount.amount])).toEqual([['2026-01', 26_000n]]);
    expect(preview.purchases.map((p) => [p.purchaseId, p.interest.amount, p.capital.amount])).toEqual([
      ['p1', 24_000n, 32_000n],
      ['p2', 18_000n, 0n],
    ]);
  });
});

describe('propiedades del reparto (simulación con generador fijo)', () => {
  let seed = 135792468n;
  const next = (max: bigint): bigint => {
    seed = (seed * 6364136223846793005n + 1442695040888963407n) % (1n << 64n);
    return (seed >> 11n) % max;
  };
  const pick = <T,>(xs: readonly T[]): T => xs[Number(next(BigInt(xs.length)))];
  const amounts = [1n, 5n, 71n, 1_200_000n, 9_007_199_254_740_993n, 10n ** 20n + 7n];
  const counts = [1, 2, 3, 12, 72];
  const rates = [0, 1, 20_000, 100_000];

  it('suma exacta, capital pagado ≤ D, ninguna cuota de capital sube y todo cuadra con el estado', () => {
    let steps = 0;
    for (let scenario = 0; scenario < 120; scenario++) {
      const dueDay = Number(next(31n)) + 1;
      let cutDay: number | undefined;
      if (next(2n) === 0n) {
        cutDay = Number(next(31n)) + 1;
        if (cutDay === dueDay) cutDay = (cutDay % 31) + 1;
      }
      const c = card({ dueDay, cutDay, fee: next(3n) === 0n ? { kind: 'FIXED_MONTHLY', amount: cop(26_000) } : { kind: 'NONE' } });
      const purchases = Array.from({ length: Number(next(3n)) + 1 }, (_, i) => {
        const purchaseDate = new Date(Date.UTC(2026, 0, Number(next(28n)) + 1));
        return make({
          id: `p${i}`,
          amount: pick(amounts),
          installments: pick(counts),
          monthlyRatePpm: pick(rates),
          purchaseDate,
          firstDueDate: firstDueDateFor(purchaseDate, dueDay, cutDay),
          dueDayAnchor: dueDay,
        });
      });
      const payments: CardPayment[] = [];
      let day = d('2026-02-01');
      for (let step = 0; step < 14; step++) {
        day = addDaysUTC(day, Number(next(40n)) + 1);
        const due = cardDue(c, purchases, payments, day);
        const balances = purchaseBalances(c, purchases, payments, day);
        const max = maxPayment(c, purchases, payments, day).amount;
        if (max === 0n) break;
        const dueSum = due.reduce((a, x) => a + x.amount.amount, 0n);
        const amount = pick([1n, max, dueSum > 0n ? dueSum : 1n, next(max) + 1n, dueSum > 0n ? next(dueSum) + 1n : 1n]);
        const allocations = allocatePayment(due, cop(amount), { purchases: balances });
        const hasExtra = allocations.some((a) => a.kind === 'EXTRA');
        const mode: ExtraMode | undefined = hasExtra ? pick<ExtraMode>(['SHORTEN', 'LOWER']) : undefined;
        const before = new Map(purchases.map((p) => [p.id, computeSchedule(p, payments, cutDay)]));
        // createCardPayment valida que la suma sea exacta y que nada vaya en cero.
        payments.push(createCardPayment({ id: `x${step}`, cardId: 'c1', seq: step + 1, paidOn: day, fromAccountId: 'a1', total: cop(amount), allocations, extraMode: mode, transactionIds: [] }));
        for (const p of purchases) {
          const after = computeSchedule(p, payments, cutDay);
          const old = new Map(before.get(p.id)!.map((r) => [r.number, r]));
          let paid = 0n;
          let prevFuture: bigint | undefined;
          for (const r of after) {
            paid += r.capitalPaid.amount;
            const was = old.get(r.number);
            expect(was).toBeDefined();
            expect(r.capitalDue.amount <= was!.capitalDue.amount).toBe(true);
            expect(r.dueDate).toEqual(was!.dueDate);
            if (r.capitalPaid.isZero() && r.interestPaid.isZero()) {
              if (prevFuture !== undefined) expect(r.capitalDue.amount <= prevFuture).toBe(true);
              prevFuture = r.capitalDue.amount;
            }
          }
          const extra = payments.flatMap((x) => x.allocations).reduce((a, x) => (x.kind === 'EXTRA' && x.purchaseId === p.id ? a + x.capital.amount : a), 0n);
          expect(paid + extra <= p.amount.amount).toBe(true);
        }
        // Deuda y compromisos se calculan con el corte de la tarjeta sin fallar y cuadran con el estado.
        const pending = purchaseBalances(c, purchases, payments, day).reduce((a, b) => a + b.pendingCapital.amount, 0n);
        expect(cardDebtWithPayments([c], purchases, payments).amount).toBe(pending);
        const commitments = cardCommitmentsWithPayments([c], purchases, payments, day, addDaysUTC(day, 3000));
        expect(commitments.every((x) => x.amount.isPositive())).toBe(true);
        steps++;
      }
    }
    expect(steps).toBeGreaterThan(300);
  });
});
