import { Money } from '../money/money';
import { Commitment } from '../projection/projection-engine';
import { startOfDayUTC } from '../shared/date';
import { dateInMonth } from './billing-cycle';
import { CardPayment } from './card-payment';
import { CardPurchase } from './card-purchase';
import { cardFeesDue, monthInWords } from './card-commitments';
import { CreditCard, YearMonth } from './credit-card';
import { purchaseSchedule, ScheduledInstallment } from './purchase-schedule';

/** Algo que se debe hoy en una tarjeta, ya sin lo pagado. */
export interface DueItem {
  kind: 'FEE' | 'INTEREST' | 'CAPITAL';
  purchaseId?: string;
  number?: number;
  month?: YearMonth;
  dueDate: Date;
  amount: Money;
  /** Vencido: `dueDate` antes de hoy. Si no, es del periodo actual. */
  overdue: boolean;
}

/** Estado de una compra abierta para repartir un pago. */
export interface PurchaseBalance {
  purchase: CardPurchase;
  schedule: ScheduledInstallment[];
  /** Capital que aún se debe (todas las cuotas). */
  pendingCapital: Money;
  /** Capital que puede recibir plata de más: el pendiente menos el que ya está en lo debido. */
  extraCapacity: Money;
}

// Las tarjetas empiezan en 2000 como pronto (ver CreditCard), así que nada vence antes.
const BEGINNING = new Date(Date.UTC(2000, 0, 1));

/** Próxima fecha de pago: el día de pago (ajustado a fin de mes) de este mes si es hoy o después; si no, el del siguiente. */
export function nextPaymentDate(on: Date, dueDay: number): Date {
  const day = startOfDayUTC(on);
  const thisMonth = dateInMonth(day.getUTCFullYear(), day.getUTCMonth(), dueDay);
  return thisMonth.getTime() >= day.getTime() ? thisMonth : dateInMonth(day.getUTCFullYear(), day.getUTCMonth() + 1, dueDay);
}

function cardPayments(card: CreditCard, payments: readonly CardPayment[]): CardPayment[] {
  return payments.filter((p) => p.cardId === card.id);
}

function openPurchases(cardId: string, purchases: readonly CardPurchase[]): CardPurchase[] {
  return purchases.filter((p) => p.cardId === cardId && !p.isClosed);
}

function feesPaid(payments: readonly CardPayment[]): Map<YearMonth, bigint> {
  const paid = new Map<YearMonth, bigint>();
  for (const p of payments) {
    for (const a of p.allocations) if (a.kind === 'FEE') paid.set(a.month, (paid.get(a.month) ?? 0n) + a.amount.amount);
  }
  return paid;
}

/** Cuotas de manejo hasta `to` con lo que falta de cada una (las pagadas por completo no salen). */
function feesOwed(card: CreditCard, purchases: readonly CardPurchase[], payments: readonly CardPayment[], to: Date) {
  const paid = feesPaid(payments);
  return cardFeesDue(card, purchases, BEGINNING, to)
    .map((fee) => ({ ...fee, amount: fee.amount.subtract(Money.of(paid.get(fee.month) ?? 0n, fee.amount.currency)) }))
    .filter((fee) => fee.amount.isPositive());
}

function pendingCapitalOf(schedule: readonly ScheduledInstallment[]): bigint {
  return schedule.reduce((a, r) => a + r.capitalDue.amount - r.capitalPaid.amount, 0n);
}

/** Cuotas ya facturadas (su corte pasó) que vencen hasta la próxima fecha de pago, con lo que falta de cada parte. */
function installmentItems(purchase: CardPurchase, schedule: readonly ScheduledInstallment[], today: number, until: number): DueItem[] {
  const items: DueItem[] = [];
  for (const row of schedule) {
    if (row.cutDate.getTime() >= today || row.dueDate.getTime() > until) continue;
    const overdue = row.dueDate.getTime() < today;
    const interest = row.interestDue.subtract(row.interestPaid);
    const capital = row.capitalDue.subtract(row.capitalPaid);
    const base = { purchaseId: purchase.id, number: row.number, dueDate: row.dueDate, overdue };
    if (interest.isPositive()) items.push({ kind: 'INTEREST', ...base, amount: interest });
    if (capital.isPositive()) items.push({ kind: 'CAPITAL', ...base, amount: capital });
  }
  return items;
}

const KIND_RANK: Record<DueItem['kind'], number> = { FEE: 0, INTEREST: 1, CAPITAL: 2 };

/** Orden del reparto: fecha; en la misma fecha manejo, interés, capital; luego la compra más antigua, su id y la cuota. */
export function compareDue(purchaseDates: ReadonlyMap<string, number>) {
  return (a: DueItem, b: DueItem): number =>
    a.dueDate.getTime() - b.dueDate.getTime() ||
    KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
    (purchaseDates.get(a.purchaseId ?? '') ?? 0) - (purchaseDates.get(b.purchaseId ?? '') ?? 0) ||
    (a.purchaseId ?? a.month ?? '').localeCompare(b.purchaseId ?? b.month ?? '') ||
    (a.number ?? 0) - (b.number ?? 0);
}

/**
 * Lo que se debe en la tarjeta al día `on`: lo vencido (`dueDate < on`) y lo del periodo actual
 * (hasta la próxima fecha de pago inclusive), ya sin lo pagado, en el orden en que se reparte un pago.
 * Una cuota entra solo cuando su corte ya pasó: antes, su interés aún no está definido.
 */
export function cardDue(card: CreditCard, purchases: readonly CardPurchase[], payments: readonly CardPayment[], on: Date): DueItem[] {
  const today = startOfDayUTC(on).getTime();
  const until = nextPaymentDate(on, card.dueDay);
  const own = cardPayments(card, payments);
  const items: DueItem[] = feesOwed(card, purchases, own, until).map((fee) => ({
    kind: 'FEE',
    month: fee.month,
    dueDate: fee.dueDate,
    amount: fee.amount,
    overdue: fee.dueDate.getTime() < today,
  }));
  const open = openPurchases(card.id, purchases);
  for (const purchase of open) items.push(...installmentItems(purchase, purchaseSchedule(purchase, own, card.cutDay, on), today, until.getTime()));
  return items.sort(compareDue(new Map(open.map((p) => [p.id, p.purchaseDate.getTime()]))));
}

/** Compras abiertas de la tarjeta con su estado y el capital que puede recibir plata de más. */
export function purchaseBalances(
  card: CreditCard,
  purchases: readonly CardPurchase[],
  payments: readonly CardPayment[],
  on: Date,
): PurchaseBalance[] {
  const own = cardPayments(card, payments);
  const today = startOfDayUTC(on).getTime();
  const until = nextPaymentDate(on, card.dueDay).getTime();
  return openPurchases(card.id, purchases).map((purchase) => {
    const currency = purchase.amount.currency;
    const schedule = purchaseSchedule(purchase, own, card.cutDay, on);
    const pending = pendingCapitalOf(schedule);
    const inDue = installmentItems(purchase, schedule, today, until)
      .filter((i) => i.kind === 'CAPITAL')
      .reduce((a, i) => a + i.amount.amount, 0n);
    return { purchase, schedule, pendingCapital: Money.of(pending, currency), extraCapacity: Money.of(pending - inDue, currency) };
  });
}

/** Lo más que se puede pagar hoy: lo vencido y del periodo más todo el capital pendiente (como liquidar hoy). */
export function maxPayment(card: CreditCard, purchases: readonly CardPurchase[], payments: readonly CardPayment[], on: Date, currency = 'COP'): Money {
  const due = cardDue(card, purchases, payments, on).map((i) => i.amount);
  const extra = purchaseBalances(card, purchases, payments, on).map((b) => b.extraCapacity);
  return Money.sum([...due, ...extra], due[0]?.currency ?? extra[0]?.currency ?? currency);
}

/** Deuda real de las tarjetas: capital pendiente con los pagos aplicados. Sin pagos es igual a `cardDebt`. */
export function cardDebtWithPayments(
  cards: readonly CreditCard[],
  purchases: readonly CardPurchase[],
  payments: readonly CardPayment[],
  currency = 'COP',
): Money {
  // El corte cambia el interés de cada cuota y con él la validación de lo pagado: siempre el de la tarjeta.
  const cutDays = new Map(cards.map((c) => [c.id, c.cutDay]));
  return Money.sum(
    purchases
      .filter((p) => !p.isClosed)
      .map((p) => Money.of(pendingCapitalOf(purchaseSchedule(p, payments.filter((x) => x.cardId === p.cardId), cutDays.get(p.cardId))), p.amount.currency)),
    purchases[0]?.amount.currency ?? currency,
  );
}

/**
 * Como `cardCommitments`, pero con lo que falta de cada cuota y de cada manejo según los pagos.
 * Lo vencido antes de `from` se fija en `from`. Sin pagos es idéntico a `cardCommitments`.
 */
export function cardCommitmentsWithPayments(
  cards: readonly CreditCard[],
  purchases: readonly CardPurchase[],
  payments: readonly CardPayment[],
  from: Date,
  to: Date,
): Commitment[] {
  const fromDay = startOfDayUTC(from);
  const toTime = startOfDayUTC(to).getTime();
  const clamp = (date: Date): Date => (date.getTime() < fromDay.getTime() ? fromDay : date);
  const cardsById = new Map(cards.map((c) => [c.id, c]));
  const out: Commitment[] = [];

  for (const purchase of purchases) {
    const card = cardsById.get(purchase.cardId);
    if (!card || purchase.isClosed) continue;
    const schedule = purchaseSchedule(purchase, cardPayments(card, payments), card.cutDay, from);
    const last = schedule[schedule.length - 1]?.number ?? purchase.installments;
    for (const row of schedule) {
      if (row.dueDate.getTime() > toTime || row.remaining.isZero()) continue;
      out.push({
        scheduledExpenseId: purchase.id,
        kind: 'CARD_INSTALLMENT',
        description: `${purchase.description} (cuota ${row.number}/${last})`,
        accountId: card.paymentAccountId,
        date: clamp(row.dueDate),
        amount: row.remaining,
      });
    }
  }

  for (const card of cards) {
    for (const fee of feesOwed(card, purchases, cardPayments(card, payments), to)) {
      out.push({
        scheduledExpenseId: card.id,
        kind: 'CARD_FEE',
        description: `Manejo ${card.name} (${monthInWords(fee.month)})`,
        accountId: card.paymentAccountId,
        date: clamp(fee.dueDate),
        amount: fee.amount,
      });
    }
  }

  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}
