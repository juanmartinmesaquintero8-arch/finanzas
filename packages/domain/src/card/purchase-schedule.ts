import { Money } from '../money/money';
import { addDaysUTC, startOfDayUTC } from '../shared/date';
import { assertDomain } from '../shared/domain-validation.error';
import { cutBefore } from './billing-cycle';
import { lowerCapitals, shortenCapitals } from './capital-recalc';
import { CardPayment, ExtraMode } from './card-payment';
import { CardPurchase } from './card-purchase';
import { buildInstallmentPlan, Installment, interestOn } from './installments';

/** Estado de una cuota calculado desde la compra y los pagos (eventos). */
export interface ScheduledInstallment {
  number: number;
  dueDate: Date;
  /** Corte que genera la cuota: su interés se calcula sobre el capital aún debido ese día. */
  cutDate: Date;
  capitalDue: Money;
  interestDue: Money;
  capitalPaid: Money;
  interestPaid: Money;
  /** (capitalDue + interestDue) − (capitalPaid + interestPaid), nunca negativo. */
  remaining: Money;
}

const time = (date: Date): number => startOfDayUTC(date).getTime();

/**
 * Corte de cada cuota. Sin corte: la 1 la fecha de compra y la k el vencimiento de k − 1.
 * Con corte: el último corte antes del vencimiento, nunca antes del vencimiento anterior (ni de la compra),
 * para que pagar a tiempo siempre cuente en la cuota siguiente. Siempre queda antes del vencimiento propio.
 */
function cutDates(purchase: CardPurchase, plan: readonly Installment[], cutDay?: number): Date[] {
  return plan.map((inst, k) => {
    const floor = k === 0 ? purchase.purchaseDate : plan[k - 1].dueDate;
    let cut = floor;
    if (cutDay !== undefined) {
      const statement = cutBefore(inst.dueDate, cutDay);
      if (statement.getTime() > floor.getTime()) cut = statement;
    }
    return cut.getTime() < inst.dueDate.getTime() ? cut : addDaysUTC(inst.dueDate, -1);
  });
}

interface Row {
  capitalDue: bigint;
  interestDue: bigint;
  capitalPaid: bigint;
  interestPaid: bigint;
  exists: boolean;
  touched: boolean;
}

interface CapitalEvent {
  on: number;
  capital: bigint;
}

function sortedBySeq(payments: readonly CardPayment[]): CardPayment[] {
  return [...payments].sort((a, b) => a.seq - b.seq);
}

/** Recalcula el capital de las cuotas que siguen a la última tocada, con `extra` de menos. */
function applyExtra(rows: Row[], extra: bigint, mode: ExtraMode | undefined): void {
  let start = 0;
  rows.forEach((row, idx) => {
    if (row.touched) start = idx + 1;
  });
  const future = rows.map((row, idx) => ({ row, idx })).filter(({ row, idx }) => idx >= start && row.exists);
  const old = future.map(({ row }) => row.capitalDue);
  const balance = old.reduce((a, b) => a + b, 0n) - extra;
  const next = mode === 'LOWER' ? lowerCapitals(old, balance) : shortenCapitals(old, balance);
  future.forEach(({ row }, i) => {
    if (i < next.length) row.capitalDue = next[i];
    else row.exists = false;
  });
}

/**
 * Cuotas de una compra con los pagos aplicados (una fila por cuota que siga existiendo).
 * - Las `paidInstallments` heredadas cuentan como pagadas, con capital e interés del plan.
 * - Interés de la cuota k = round_half_up(O_k · ppm / 10^6). Si su corte ya pasó (antes de `on` o del último pago),
 *   O_k = D − capital pagado hasta el corte; si no, se proyecta como si lo anterior se pagara a tiempo.
 * - Plata de más: recálculo SHORTEN o LOWER de las cuotas que siguen, en orden de `seq`; las fechas no cambian.
 * Sin pagos, o pagando cada cuota completa en su fecha, es idéntico a `buildInstallmentPlan`.
 */
export function purchaseSchedule(
  purchase: CardPurchase,
  payments: readonly CardPayment[],
  cutDay?: number,
  on?: Date,
): ScheduledInstallment[] {
  const plan = buildInstallmentPlan(purchase);
  const currency = purchase.amount.currency;
  const inherited = purchase.paidInstallments;
  const own = sortedBySeq(payments).filter((p) => p.allocations.some((a) => a.kind !== 'FEE' && a.purchaseId === purchase.id));
  assertDomain(!purchase.isClosed || own.length === 0, 'La compra está cerrada');

  const rows: Row[] = plan.map((inst) => {
    const paid = inst.number <= inherited;
    return {
      capitalDue: inst.capital.amount,
      interestDue: inst.interest.amount,
      capitalPaid: paid ? inst.capital.amount : 0n,
      interestPaid: paid ? inst.interest.amount : 0n,
      exists: !purchase.isClosed || paid,
      touched: paid,
    };
  });

  const events: CapitalEvent[] = [];
  for (const payment of own) {
    const paidOn = time(payment.paidOn);
    let extra = 0n;
    for (const a of payment.allocations) {
      if (a.kind === 'FEE' || a.purchaseId !== purchase.id) continue;
      if (a.kind === 'EXTRA') {
        extra += a.capital.amount;
        continue;
      }
      const row = rows[a.number - 1];
      assertDomain(a.number > inherited && row !== undefined && row.exists, 'La cuota indicada no es válida');
      row.capitalPaid += a.capital.amount;
      row.interestPaid += a.interest.amount;
      row.touched = true;
      assertDomain(row.capitalPaid <= row.capitalDue, 'El pago supera el capital de la cuota');
      if (a.capital.isPositive()) events.push({ on: paidOn, capital: a.capital.amount });
    }
    if (extra > 0n) {
      applyExtra(rows, extra, payment.extraMode);
      events.push({ on: paidOn, capital: extra });
    }
  }

  // Lo que ya se sabe: hasta `on` o hasta el último pago de la tarjeta, lo que sea más tarde.
  const known = payments.reduce((max, p) => Math.max(max, time(p.paidOn)), on === undefined ? Number.NEGATIVE_INFINITY : time(on));
  const cuts = cutDates(purchase, plan, purchase.isClosed ? undefined : cutDay);
  const debt = purchase.amount.amount;
  const inheritedCapital = plan.slice(0, inherited).reduce((a, i) => a + i.capital.amount, 0n);

  for (let k = inherited; k < rows.length; k++) {
    const row = rows[k];
    if (!row.exists) continue;
    const cut = cuts[k].getTime();
    let owed: bigint;
    if (cut < known) {
      owed = debt - inheritedCapital - events.filter((e) => e.on <= cut).reduce((a, e) => a + e.capital, 0n);
    } else {
      owed = rows.slice(k).reduce((a, r) => (r.exists ? a + r.capitalDue - r.capitalPaid : a), 0n);
    }
    row.interestDue = interestOn(owed, purchase.monthlyRatePpm);
    assertDomain(row.interestPaid <= row.interestDue, 'El interés pagado supera el de la cuota');
  }

  const out: ScheduledInstallment[] = [];
  rows.forEach((row, k) => {
    if (!row.exists) return;
    const remaining = row.capitalDue + row.interestDue - row.capitalPaid - row.interestPaid;
    out.push({
      number: k + 1,
      dueDate: plan[k].dueDate,
      cutDate: cuts[k],
      capitalDue: Money.of(row.capitalDue, currency),
      interestDue: Money.of(row.interestDue, currency),
      capitalPaid: Money.of(row.capitalPaid, currency),
      interestPaid: Money.of(row.interestPaid, currency),
      remaining: Money.of(remaining > 0n ? remaining : 0n, currency),
    });
  });
  return out;
}
