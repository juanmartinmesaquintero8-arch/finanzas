import { Money } from '../money/money';
import { daysInMonthUTC } from '../shared/date';
import { CardPurchase } from './card-purchase';

export interface Installment {
  number: number;
  dueDate: Date;
  capital: Money;
  interest: Money;
  total: Money;
  /** Capital pendiente justo antes de pagar esta cuota (base del interés). */
  balanceBefore: Money;
}

export interface PlanSummary {
  first: Installment;
  last: Installment;
  totalInterest: Money;
  totalToPay: Money;
}

export interface SettleOffer {
  capital: Money;
  interest: Money;
  total: Money;
}

const PPM = 1_000_000n;
const HALF_PPM = 500_000n;

/** Fecha con el día `day` (ajustado a fin de mes) del mes `month` (0-11, admite desbordes) del año `year`. */
function dateInMonth(year: number, month: number, day: number): Date {
  const normalizedYear = year + Math.floor(month / 12);
  const normalizedMonth = ((month % 12) + 12) % 12;
  return new Date(Date.UTC(normalizedYear, normalizedMonth, Math.min(day, daysInMonthUTC(normalizedYear, normalizedMonth))));
}

/** Día de pago del mes siguiente a la compra, ajustado a fin de mes. */
export function defaultFirstDueDate(purchaseDate: Date, dueDay: number): Date {
  return dateInMonth(purchaseDate.getUTCFullYear(), purchaseDate.getUTCMonth() + 1, dueDay);
}

function interestOn(balance: bigint, ppm: number): bigint {
  return (balance * BigInt(ppm) + HALF_PPM) / PPM;
}

/** Capital pendiente antes de la cuota `k` (1-based): B1 = D; Bk = (N − k + 1)·q para k ≥ 2. */
function balanceBefore(total: bigint, count: number, k: number): bigint {
  if (k === 1) return total;
  return BigInt(count - k + 1) * (total / BigInt(count));
}

/** Cuotas de una compra, desde cero (las pagadas también aparecen). Capital fijo, interés sobre saldo. */
export function buildInstallmentPlan(purchase: CardPurchase): Installment[] {
  const { installments: count, monthlyRatePpm } = purchase;
  const currency = purchase.amount.currency;
  const debt = purchase.amount.amount;
  const q = debt / BigInt(count);
  const r = debt % BigInt(count);
  const first = purchase.firstDueDate;
  const plan: Installment[] = [];
  for (let k = 1; k <= count; k++) {
    const capital = k === 1 ? q + r : q;
    const balance = balanceBefore(debt, count, k);
    const interest = interestOn(balance, monthlyRatePpm);
    plan.push({
      number: k,
      dueDate: dateInMonth(first.getUTCFullYear(), first.getUTCMonth() + (k - 1), first.getUTCDate()),
      capital: Money.of(capital, currency),
      interest: Money.of(interest, currency),
      total: Money.of(capital + interest, currency),
      balanceBefore: Money.of(balance, currency),
    });
  }
  return plan;
}

export function planSummary(plan: readonly Installment[]): PlanSummary {
  const first = plan[0];
  const currency = first.total.currency;
  return {
    first,
    last: plan[plan.length - 1],
    totalInterest: Money.sum(plan.map((i) => i.interest), currency),
    totalToPay: Money.sum(plan.map((i) => i.total), currency),
  };
}

/** Capital que aún se debe (cuotas sin pagar); una compra cerrada no debe nada. */
function remainingCapital(purchase: CardPurchase): bigint {
  if (purchase.isClosed || purchase.paidInstallments >= purchase.installments) return 0n;
  return balanceBefore(purchase.amount.amount, purchase.installments, purchase.paidInstallments + 1);
}

/** Liquidar hoy: capital restante más solo el interés de la próxima cuota. */
export function settleOffer(purchase: CardPurchase): SettleOffer {
  const currency = purchase.amount.currency;
  const capital = remainingCapital(purchase);
  const interest = capital === 0n ? 0n : interestOn(capital, purchase.monthlyRatePpm);
  return {
    capital: Money.of(capital, currency),
    interest: Money.of(interest, currency),
    total: Money.of(capital + interest, currency),
  };
}

/** Deuda de las tarjetas: capital pendiente, sin interés futuro. Las compras cerradas no suman. */
export function cardDebt(purchases: readonly CardPurchase[], currency = 'COP'): Money {
  return Money.of(
    purchases.reduce((acc, p) => acc + remainingCapital(p), 0n),
    purchases[0]?.amount.currency ?? currency,
  );
}
