import { Money } from '../money/money';
import { CardPurchase, CardPurchaseProps } from './card-purchase';
import { buildInstallmentPlan, cardDebt, defaultFirstDueDate, planSummary, settleOffer } from './installments';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (xs: { dueDate: Date }[]) => xs.map((x) => x.dueDate.toISOString().slice(0, 10));
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
    monthlyRatePpm: 0,
    paidInstallments: 0,
    ...rest,
  });
};

describe('defaultFirstDueDate', () => {
  it('es el día de pago del mes siguiente', () => {
    expect(defaultFirstDueDate(d('2026-11-08'), 15)).toEqual(d('2026-12-15'));
  });
  it('diciembre pasa a enero del año siguiente', () => {
    expect(defaultFirstDueDate(d('2026-12-20'), 5)).toEqual(d('2027-01-05'));
  });
  it('ajusta a fin de mes (dueDay 31)', () => {
    expect(defaultFirstDueDate(d('2026-01-31'), 31)).toEqual(d('2026-02-28'));
    expect(defaultFirstDueDate(d('2028-01-10'), 31)).toEqual(d('2028-02-29'));
    expect(defaultFirstDueDate(d('2026-03-10'), 31)).toEqual(d('2026-04-30'));
  });
  it('compra un 31 de enero con día de pago 30 cae el 28 de febrero', () => {
    expect(defaultFirstDueDate(d('2026-01-31'), 30)).toEqual(d('2026-02-28'));
  });
});

describe('buildInstallmentPlan', () => {
  it('control: 1.200.000 a 12 cuotas al 2 % M.V. = 156.000 de interés', () => {
    const plan = buildInstallmentPlan(make({ monthlyRatePpm: 20_000 }));
    expect(plan).toHaveLength(12);
    const s = planSummary(plan);
    expect(s.totalInterest.amount).toBe(156_000n);
    expect(s.totalToPay.amount).toBe(1_356_000n);
    expect(plan[0].capital.amount).toBe(100_000n);
    expect(plan[0].balanceBefore.amount).toBe(1_200_000n);
    expect(plan[0].interest.amount).toBe(24_000n);
    expect(plan[1].balanceBefore.amount).toBe(1_100_000n);
    expect(plan[11].balanceBefore.amount).toBe(100_000n);
    expect(plan[11].interest.amount).toBe(2_000n);
    expect(s.first).toBe(plan[0]);
    expect(s.last).toBe(plan[11]);
  });

  it('el residuo va en la primera cuota', () => {
    const plan = buildInstallmentPlan(make({ amount: 100, installments: 3 }));
    expect(plan.map((i) => i.capital.amount)).toEqual([34n, 33n, 33n]);
    expect(plan.map((i) => i.balanceBefore.amount)).toEqual([100n, 66n, 33n]);
  });

  it('una sola cuota con interés', () => {
    const plan = buildInstallmentPlan(make({ amount: 500_000, installments: 1, monthlyRatePpm: 19_997 }));
    expect(plan).toHaveLength(1);
    expect(plan[0].capital.amount).toBe(500_000n);
    expect(plan[0].interest.amount).toBe(9_999n); // 500000*19997/1e6 = 9998,5 -> 9999
    expect(plan[0].total.amount).toBe(509_999n);
  });

  it('el interés redondea a la mitad hacia arriba con enteros', () => {
    const plan = buildInstallmentPlan(make({ amount: 1, installments: 1, monthlyRatePpm: 500_000 }));
    expect(plan[0].interest.amount).toBe(1n);
    const p2 = buildInstallmentPlan(make({ amount: 1, installments: 1, monthlyRatePpm: 499_999 }));
    expect(p2[0].interest.amount).toBe(0n);
  });

  it('fechas: 31 de enero no acumula el recorte (31 ene, 28 feb, 31 mar)', () => {
    const plan = buildInstallmentPlan(make({ installments: 4, purchaseDate: d('2026-01-01'), firstDueDate: d('2026-01-31') }));
    expect(iso(plan)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('fechas: año bisiesto', () => {
    const plan = buildInstallmentPlan(make({ installments: 2, purchaseDate: d('2028-01-01'), firstDueDate: d('2028-01-31') }));
    expect(iso(plan)).toEqual(['2028-01-31', '2028-02-29']);
  });

  it('fechas: diciembre pasa a enero', () => {
    const plan = buildInstallmentPlan(make({ installments: 3, purchaseDate: d('2026-11-01'), firstDueDate: d('2026-12-15') }));
    expect(iso(plan)).toEqual(['2026-12-15', '2027-01-15', '2027-02-15']);
  });

  it('72 cuotas cruzan varios años', () => {
    const plan = buildInstallmentPlan(make({ installments: 72, purchaseDate: d('2026-01-01'), firstDueDate: d('2026-01-30') }));
    expect(plan[71].dueDate).toEqual(d('2031-12-30'));
    expect(plan[1].dueDate).toEqual(d('2026-02-28'));
  });

  it('el plan incluye las cuotas ya pagadas (se calcula desde la compra)', () => {
    expect(buildInstallmentPlan(make({ paidInstallments: 5 }))).toHaveLength(12);
  });
});

describe('propiedades del plan', () => {
  // Generador determinista (LCG de 64 bits con bigint) para no depender de librerías.
  let seed = 123456789n;
  const next = (max: bigint): bigint => {
    seed = (seed * 6364136223846793005n + 1442695040888963407n) % (1n << 64n);
    return (seed >> 11n) % max;
  };
  const amounts: bigint[] = [1n, 2n, 5n, 71n, 72n, 73n, 99n, 100n, 1_200_000n, 9_007_199_254_740_991n, 9_007_199_254_740_993n, 10n ** 20n + 7n];
  for (let i = 0; i < 40; i++) amounts.push(next(10n ** 18n) + 1n);
  for (let i = 0; i < 30; i++) amounts.push(next(200n) + 1n);
  const counts = [1, 2, 3, 7, 11, 12, 13, 24, 36, 48, 71, 72];
  const rates = [0, 1, 19_997, 20_000, 100_000];

  it('capital suma D; total e interés no suben; ningún capital negativo', () => {
    let cases = 0;
    for (const D of amounts) {
      for (const N of counts) {
        const rate = rates[Number(next(BigInt(rates.length)))];
        const plan = buildInstallmentPlan(make({ amount: D, installments: N, monthlyRatePpm: rate }));
        expect(plan).toHaveLength(N);
        const sum = plan.reduce((a, i) => a + i.capital.amount, 0n);
        expect(sum).toBe(D);
        for (let k = 0; k < N; k++) {
          const inst = plan[k];
          expect(inst.number).toBe(k + 1);
          expect(inst.capital.amount >= 0n).toBe(true);
          expect(inst.interest.amount >= 0n).toBe(true);
          expect(inst.total.amount).toBe(inst.capital.amount + inst.interest.amount);
          if (k > 0) {
            expect(inst.total.amount <= plan[k - 1].total.amount).toBe(true);
            expect(inst.interest.amount <= plan[k - 1].interest.amount).toBe(true);
            expect(inst.balanceBefore.amount).toBe(plan[k - 1].balanceBefore.amount - plan[k - 1].capital.amount);
          }
        }
        cases++;
      }
    }
    expect(cases).toBeGreaterThan(900);
  });
});

describe('settleOffer', () => {
  it('capital restante más solo el interés de la próxima cuota', () => {
    const p = make({ monthlyRatePpm: 20_000, paidInstallments: 2 });
    const o = settleOffer(p);
    expect(o.capital.amount).toBe(1_000_000n);
    expect(o.interest.amount).toBe(20_000n);
    expect(o.total.amount).toBe(1_020_000n);
  });
  it('sin pagos: capital total más interés de la primera cuota', () => {
    const o = settleOffer(make({ monthlyRatePpm: 20_000 }));
    expect(o.capital.amount).toBe(1_200_000n);
    expect(o.interest.amount).toBe(24_000n);
  });
  it('con residuo y tasa 0', () => {
    const o = settleOffer(make({ amount: 100, installments: 3, paidInstallments: 1 }));
    expect(o.capital.amount).toBe(66n);
    expect(o.interest.amount).toBe(0n);
  });
  it('todo pagado o compra cerrada: cero', () => {
    expect(settleOffer(make({ paidInstallments: 12, monthlyRatePpm: 20_000 })).total.amount).toBe(0n);
    expect(settleOffer(make({ monthlyRatePpm: 20_000 }).close(d('2026-03-01'))).total.amount).toBe(0n);
  });
});

describe('cardDebt', () => {
  it('suma el capital pendiente, sin interés futuro', () => {
    const a = make({ monthlyRatePpm: 20_000, paidInstallments: 2 });
    const b = make({ id: 'p2', amount: 100, installments: 3 });
    expect(cardDebt([a, b]).amount).toBe(1_000_000n + 100n);
  });
  it('no suma compras cerradas ni pagadas', () => {
    const closed = make({ id: 'p3' }).close(d('2026-03-01'));
    const paid = make({ id: 'p4', paidInstallments: 12 });
    expect(cardDebt([closed, paid]).amount).toBe(0n);
    expect(cardDebt([]).amount).toBe(0n);
  });
});
