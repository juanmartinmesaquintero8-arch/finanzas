import { Money } from '../money/money';
import { DomainValidationError } from '../shared/domain-validation.error';
import { CardPurchase, CardPurchaseProps } from './card-purchase';
import { Allocation, CardPayment, createCardPayment, ExtraMode } from './card-payment';
import { buildInstallmentPlan, firstDueDateFor } from './installments';
import { purchaseSchedule, ScheduledInstallment } from './purchase-schedule';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const cop = (n: bigint | number) => Money.of(n, 'COP');
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
const inst = (number: number, interest: bigint | number, capital: bigint | number, purchaseId = 'p1'): Allocation => ({
  kind: 'INSTALLMENT',
  purchaseId,
  number,
  interest: cop(interest),
  capital: cop(capital),
});
const extra = (capital: bigint | number, purchaseId = 'p1'): Allocation => ({ kind: 'EXTRA', purchaseId, capital: cop(capital) });
const total = (allocations: Allocation[]) =>
  allocations.reduce((a, x) => a + (x.kind === 'INSTALLMENT' ? x.interest.amount + x.capital.amount : x.kind === 'EXTRA' ? x.capital.amount : x.amount.amount), 0n);
const pay = (seq: number, paidOn: Date, allocations: Allocation[], extraMode?: ExtraMode): CardPayment =>
  createCardPayment({ id: `pay${seq}`, cardId: 'c1', seq, paidOn, fromAccountId: 'a1', total: cop(total(allocations)), allocations, extraMode, transactionIds: [] });
const row = (s: ScheduledInstallment) => ({
  number: s.number,
  capitalDue: s.capitalDue.amount,
  interestDue: s.interestDue.amount,
  capitalPaid: s.capitalPaid.amount,
  interestPaid: s.interestPaid.amount,
  remaining: s.remaining.amount,
});

describe('purchaseSchedule: propiedades frente a buildInstallmentPlan', () => {
  let seed = 246813579n;
  const next = (max: bigint): bigint => {
    seed = (seed * 6364136223846793005n + 1442695040888963407n) % (1n << 64n);
    return (seed >> 11n) % max;
  };
  const amounts: bigint[] = [1n, 2n, 5n, 71n, 72n, 73n, 100n, 1_200_000n, 9_007_199_254_740_991n, 9_007_199_254_740_993n, 10n ** 20n + 7n];
  for (let i = 0; i < 12; i++) amounts.push(next(10n ** 18n) + 1n);
  for (let i = 0; i < 8; i++) amounts.push(next(200n) + 1n);
  const counts = [1, 2, 3, 12, 13, 36, 71, 72];
  const rates = [0, 1, 19_997, 20_000, 100_000];
  const randomPurchase = (D: bigint, N: number) => {
    const withCut = next(2n) === 0n;
    const dueDay = Number(next(31n)) + 1;
    let cutDay: number | undefined;
    if (withCut) {
      cutDay = Number(next(31n)) + 1;
      if (cutDay === dueDay) cutDay = (cutDay % 31) + 1;
    }
    const purchaseDate = new Date(Date.UTC(2026, Number(next(12n)), Number(next(28n)) + 1));
    const purchase = make({
      amount: D,
      installments: N,
      monthlyRatePpm: rates[Number(next(BigInt(rates.length)))],
      purchaseDate,
      firstDueDate: firstDueDateFor(purchaseDate, dueDay, cutDay),
      dueDayAnchor: dueDay,
    });
    return { purchase, cutDay };
  };

  it('sin pagos nuevos es idéntico al plan, cuota por cuota (con y sin corte)', () => {
    let cases = 0;
    for (const D of amounts) {
      for (const N of counts) {
        const { purchase, cutDay } = randomPurchase(D, N);
        const plan = buildInstallmentPlan(purchase);
        const schedule = purchaseSchedule(purchase, [], cutDay);
        expect(schedule).toHaveLength(N);
        schedule.forEach((s, k) => {
          expect(s.number).toBe(plan[k].number);
          expect(s.dueDate).toEqual(plan[k].dueDate);
          expect(s.capitalDue.amount).toBe(plan[k].capital.amount);
          expect(s.interestDue.amount).toBe(plan[k].interest.amount);
          expect(s.capitalPaid.amount).toBe(0n);
          expect(s.interestPaid.amount).toBe(0n);
          expect(s.remaining.amount).toBe(plan[k].total.amount);
          expect(s.cutDate.getTime() < s.dueDate.getTime()).toBe(true);
          if (k > 0) expect(s.cutDate.getTime() >= plan[k - 1].dueDate.getTime()).toBe(true);
        });
        cases++;
      }
    }
    expect(cases).toBeGreaterThan(200);
  });

  it('pagar cada cuota completa en su fecha da lo mismo que el plan', () => {
    let cases = 0;
    for (const D of amounts) {
      for (const N of counts) {
        const { purchase, cutDay } = randomPurchase(D, N);
        const plan = buildInstallmentPlan(purchase);
        const payments = plan
          .filter((i) => i.total.isPositive())
          .map((i, idx) => pay(idx + 1, i.dueDate, [inst(i.number, i.interest.amount, i.capital.amount)]));
        const schedule = purchaseSchedule(purchase, payments, cutDay);
        expect(schedule).toHaveLength(N);
        let capitalPaid = 0n;
        schedule.forEach((s, k) => {
          expect(s.capitalDue.amount).toBe(plan[k].capital.amount);
          expect(s.interestDue.amount).toBe(plan[k].interest.amount);
          expect(s.capitalPaid.amount).toBe(plan[k].capital.amount);
          expect(s.interestPaid.amount).toBe(plan[k].interest.amount);
          expect(s.remaining.amount).toBe(0n);
          capitalPaid += s.capitalPaid.amount;
        });
        expect(capitalPaid).toBe(D);
        cases++;
      }
    }
    expect(cases).toBeGreaterThan(200);
  });

  it('cuotas heredadas pagadas: mismas cifras del plan y sin evento', () => {
    for (const N of counts) {
      const paid = Math.floor(N / 2);
      const purchase = make({ amount: 1_000_003n, installments: N, paidInstallments: paid });
      const plan = buildInstallmentPlan(purchase);
      const schedule = purchaseSchedule(purchase, []);
      expect(schedule).toHaveLength(N);
      schedule.forEach((s, k) => {
        expect(s.capitalDue.amount).toBe(plan[k].capital.amount);
        expect(s.interestDue.amount).toBe(plan[k].interest.amount);
        const isPaid = k < paid;
        expect(s.capitalPaid.amount).toBe(isPaid ? plan[k].capital.amount : 0n);
        expect(s.interestPaid.amount).toBe(isPaid ? plan[k].interest.amount : 0n);
        expect(s.remaining.amount).toBe(isPaid ? 0n : plan[k].total.amount);
      });
    }
  });
});

describe('purchaseSchedule: casos', () => {
  it('compra cerrada heredada: sin cuotas pendientes', () => {
    const purchase = make({ paidInstallments: 3 }).close(d('2026-05-01'));
    const schedule = purchaseSchedule(purchase, []);
    expect(schedule).toHaveLength(3);
    expect(schedule.every((s) => s.remaining.isZero())).toBe(true);
    expect(purchaseSchedule(make().close(d('2026-02-01')), [])).toEqual([]);
  });

  it('rechaza pagos a una compra cerrada', () => {
    const purchase = make({ paidInstallments: 3 }).close(d('2026-05-01'));
    expect(() => purchaseSchedule(purchase, [pay(1, d('2026-06-01'), [extra(1)], 'SHORTEN')])).toThrow(DomainValidationError);
  });

  it('pago parcial: cubre interés antes que capital; lo que falta queda; el interés siguiente sube', () => {
    // D = 1.200.000, 12 cuotas, 2 % M.V. Cuota 1: capital 100.000 + interés 24.000.
    const purchase = make();
    const p1 = pay(1, d('2026-02-15'), [inst(1, 24_000, 36_000)]);
    const s1 = purchaseSchedule(purchase, [p1], undefined, d('2026-03-01')).map(row);
    expect(s1[0]).toEqual({ number: 1, capitalDue: 100_000n, interestDue: 24_000n, capitalPaid: 36_000n, interestPaid: 24_000n, remaining: 64_000n });
    // Capital debido al corte de la cuota 2 (15 feb): 1.200.000 − 36.000 = 1.164.000; × 2 % = 23.280 (el plan decía 22.000).
    expect(s1[1]).toEqual({ number: 2, capitalDue: 100_000n, interestDue: 23_280n, capitalPaid: 0n, interestPaid: 0n, remaining: 123_280n });
    // El corte de la cuota 3 (15 mar) aún no llega: se proyecta como si lo anterior se pagara a tiempo.
    expect(s1[2].interestDue).toBe(20_000n);
    // Si llega el 15 de marzo sin más pagos, la cuota 3 se calcula sobre 1.164.000.
    expect(purchaseSchedule(purchase, [p1], undefined, d('2026-03-16'))[2].interestDue.amount).toBe(23_280n);
    // El mismo día del pago (corte de la cuota 2) aún se puede abonar: se proyecta.
    expect(purchaseSchedule(purchase, [p1])[1].interestDue.amount).toBe(22_000n);

    // Segundo pago el 1 de marzo: primero cierra lo que faltaba de la cuota 1.
    const p2 = pay(2, d('2026-03-01'), [inst(1, 0, 64_000), inst(2, 23_280, 12_720)]);
    const s2 = purchaseSchedule(purchase, [p1, p2], undefined, d('2026-03-16')).map(row);
    expect(s2[0].remaining).toBe(0n);
    expect(s2[1]).toEqual({ number: 2, capitalDue: 100_000n, interestDue: 23_280n, capitalPaid: 12_720n, interestPaid: 23_280n, remaining: 87_280n });
    // Al 15 de marzo se deben 1.200.000 − 112.720 = 1.087.280 → 21.745,6 → 21.746.
    expect(s2[2].interestDue).toBe(21_746n);
  });

  it('plata de más con SHORTEN después de un parcial: misma cuota, menos cuotas, fechas iguales', () => {
    const purchase = make();
    const p1 = pay(1, d('2026-02-15'), [inst(1, 24_000, 36_000)]);
    const p2 = pay(2, d('2026-03-01'), [inst(1, 0, 64_000), inst(2, 23_280, 12_720)]);
    const p3 = pay(3, d('2026-03-10'), [inst(2, 0, 87_280), extra(412_720)], 'SHORTEN');
    const before = purchaseSchedule(purchase, []);
    const s = purchaseSchedule(purchase, [p1, p2, p3]);
    // B = 1.000.000 − 412.720 = 587.280 → ceil(587.280 / 100.000) = 6 cuotas (3 a 8).
    expect(s.map((x) => x.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(s.slice(2).map((x) => x.capitalDue.amount)).toEqual([100_000n, 100_000n, 100_000n, 100_000n, 100_000n, 87_280n]);
    s.forEach((x, k) => expect(x.dueDate).toEqual(before[k].dueDate));
    // Cuota 3: al 15 de marzo se deben 587.280 → 11.745,6 → 11.746.
    expect(s.slice(2).map((x) => x.interestDue.amount)).toEqual([11_746n, 9_746n, 7_746n, 5_746n, 3_746n, 1_746n]);
    // Capital de las cuotas que quedan + plata de más = D.
    expect(s.reduce((a, x) => a + x.capitalDue.amount, 0n) + 412_720n).toBe(1_200_000n);
  });

  it('plata de más con LOWER: mismas cuotas, más baratas', () => {
    const purchase = make();
    const p1 = pay(1, d('2026-02-15'), [inst(1, 24_000, 36_000)]);
    const p2 = pay(2, d('2026-03-01'), [inst(1, 0, 64_000), inst(2, 23_280, 12_720)]);
    const p3 = pay(3, d('2026-03-10'), [inst(2, 0, 87_280), extra(412_720)], 'LOWER');
    const s = purchaseSchedule(purchase, [p1, p2, p3]);
    expect(s).toHaveLength(12);
    expect(s.slice(2).every((x) => x.capitalDue.amount === 58_728n)).toBe(true);
    expect(s[2].interestDue.amount).toBe(11_746n);
    // 528.552 × 2 % = 10.571,04 → 10.571.
    expect(s[3].interestDue.amount).toBe(10_571n);
  });

  it('LOWER con residuo: las primeras cuotas llevan q′ + 1', () => {
    const purchase = make({ amount: 1_000, installments: 4, monthlyRatePpm: 0 });
    const p1 = pay(1, d('2026-02-15'), [inst(1, 0, 250), extra(1)], 'LOWER');
    expect(purchaseSchedule(purchase, [p1]).map((x) => x.capitalDue.amount)).toEqual([250n, 250n, 250n, 249n]);
    const p2 = pay(2, d('2026-02-20'), [extra(3)], 'LOWER');
    // B = 749 − 3 = 746, n = 3: q′ = 248, r′ = 2.
    expect(purchaseSchedule(purchase, [p1, p2]).map((x) => x.capitalDue.amount)).toEqual([250n, 249n, 249n, 248n]);
  });

  it('varios recálculos seguidos se aplican en orden de seq', () => {
    const purchase = make({ amount: 1_000, installments: 4, monthlyRatePpm: 0 });
    const a = pay(1, d('2026-02-15'), [inst(1, 0, 250), extra(300)], 'SHORTEN');
    const b = pay(2, d('2026-02-15'), [extra(150)], 'LOWER');
    // seq 1: [250, 200]; seq 2: B = 300, n = 2 → [150, 150].
    expect(purchaseSchedule(purchase, [b, a]).map((x) => x.capitalDue.amount)).toEqual([250n, 150n, 150n]);
  });

  it('con corte: la plata de más antes del corte baja el interés de la primera cuota', () => {
    // Pago el 5, corte el 20. Compra 10 ene → corte 20 ene → vence 5 feb.
    const purchase = make({ firstDueDate: firstDueDateFor(d('2026-01-10'), 5, 20), dueDayAnchor: 5 });
    expect(purchase.firstDueDate).toEqual(d('2026-02-05'));
    const s = purchaseSchedule(purchase, [pay(1, d('2026-01-15'), [extra(200_000)], 'SHORTEN')], 20);
    expect(s[0].cutDate).toEqual(d('2026-01-20'));
    expect(s[1].cutDate).toEqual(d('2026-02-20'));
    expect(s).toHaveLength(10);
    // Al corte del 20 ene se deben 1.000.000 → 20.000.
    expect(s[0].interestDue.amount).toBe(20_000n);
    // El mismo pago después del corte ya no baja la cuota 1.
    const late = purchaseSchedule(purchase, [pay(1, d('2026-01-21'), [extra(200_000)], 'SHORTEN')], 20);
    expect(late[0].interestDue.amount).toBe(24_000n);
    expect(late[1].interestDue.amount).toBe(18_000n);
  });

  it('sin corte: el corte de la cuota k es el vencimiento de k − 1 (y el de la 1, la compra)', () => {
    const s = purchaseSchedule(make(), []);
    expect(s[0].cutDate).toEqual(d('2026-01-10'));
    expect(s[1].cutDate).toEqual(d('2026-02-15'));
    expect(s[11].cutDate).toEqual(d('2026-12-15'));
  });

  it('D < N y tasa 0: cuotas de capital cero también existen y se pagan sin pagos', () => {
    const purchase = make({ amount: 5, installments: 12, monthlyRatePpm: 0 });
    const s = purchaseSchedule(purchase, [pay(1, d('2026-02-15'), [inst(1, 0, 5)])]);
    expect(s).toHaveLength(12);
    expect(s.every((x) => x.remaining.isZero())).toBe(true);
  });

  it('rechaza asignaciones imposibles', () => {
    const purchase = make({ paidInstallments: 2 });
    expect(() => purchaseSchedule(purchase, [pay(1, d('2026-04-15'), [inst(2, 0, 1)])])).toThrow('La cuota indicada no es válida');
    expect(() => purchaseSchedule(purchase, [pay(1, d('2026-04-15'), [inst(13, 0, 1)])])).toThrow('La cuota indicada no es válida');
    expect(() => purchaseSchedule(purchase, [pay(1, d('2026-04-15'), [inst(3, 0, 100_001)])])).toThrow('El pago supera el capital de la cuota');
    expect(() => purchaseSchedule(purchase, [pay(1, d('2026-04-15'), [extra(1_000_001)], 'SHORTEN')])).toThrow('La plata de más supera el capital pendiente');
    expect(() => purchaseSchedule(purchase, [pay(1, d('2026-04-15'), [inst(3, 20_001, 0)])])).toThrow('El interés pagado supera el de la cuota');
  });

  it('ignora asignaciones de otras compras', () => {
    expect(purchaseSchedule(make(), [pay(1, d('2026-02-15'), [extra(10, 'otra')], 'SHORTEN')]).map(row)).toEqual(purchaseSchedule(make(), []).map(row));
  });
});
