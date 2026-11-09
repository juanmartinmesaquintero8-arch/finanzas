import { Money } from '../money/money';
import { Commitment } from '../projection/projection-engine';
import { daysInMonthUTC, startOfDayUTC } from '../shared/date';
import { CardPurchase } from './card-purchase';
import { CreditCard, YearMonth } from './credit-card';
import { buildInstallmentPlan } from './installments';

export interface CardFeeDue {
  cardId: string;
  /** Mes que se cobra (`YYYY-MM`); vence el día de pago del mes siguiente. */
  month: YearMonth;
  dueDate: Date;
  amount: Money;
}

function parseMonth(month: YearMonth): number {
  return Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1);
}

function formatMonth(index: number): YearMonth {
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

function dueDateOfMonth(monthIndex: number, dueDay: number): Date {
  const next = monthIndex + 1;
  const year = Math.floor(next / 12);
  const month = next % 12;
  return new Date(Date.UTC(year, month, Math.min(dueDay, daysInMonthUTC(year, month))));
}

function purchaseMonths(cardId: string, purchases: readonly CardPurchase[]): Set<number> {
  const months = new Set<number>();
  for (const p of purchases) {
    if (p.cardId === cardId) months.add(p.purchaseDate.getUTCFullYear() * 12 + p.purchaseDate.getUTCMonth());
  }
  return months;
}

/**
 * Cuotas de manejo de la tarjeta que vencen en [from, to] (por fecha de vencimiento, ambos incluidos).
 * La del mes M vence el día de pago de M + 1, para M >= feeStartMonth y M > feesSettledThrough.
 * ON_MOVEMENT exige una compra de esta tarjeta con fecha en M; pagar cuotas no cuenta como movimiento.
 */
export function cardFeesDue(card: CreditCard, purchases: readonly CardPurchase[], from: Date, to: Date): CardFeeDue[] {
  if (card.fee.kind === 'NONE') return [];
  const fromTime = startOfDayUTC(from).getTime();
  const toTime = startOfDayUTC(to).getTime();
  let first = parseMonth(card.feeStartMonth);
  if (card.feesSettledThrough !== undefined) first = Math.max(first, parseMonth(card.feesSettledThrough) + 1);
  // Mes más tardío cuyo vencimiento (mes siguiente) puede caer en `to`.
  const last = startOfDayUTC(to).getUTCFullYear() * 12 + startOfDayUTC(to).getUTCMonth() - 1;
  const withMovement = card.fee.kind === 'ON_MOVEMENT' ? purchaseMonths(card.id, purchases) : undefined;
  const result: CardFeeDue[] = [];
  for (let m = first; m <= last; m++) {
    if (withMovement && !withMovement.has(m)) continue;
    const dueDate = dueDateOfMonth(m, card.dueDay);
    const time = dueDate.getTime();
    if (time < fromTime || time > toTime) continue;
    result.push({ cardId: card.id, month: formatMonth(m), dueDate, amount: card.fee.amount });
  }
  return result;
}

/**
 * Compromisos de tarjeta hasta `to`: cuotas sin pagar de compras abiertas y cuotas de manejo.
 * Lo vencido antes de `from` se incluye con fecha `from` para no desordenar la línea de tiempo.
 */
export function cardCommitments(
  cards: readonly CreditCard[],
  purchases: readonly CardPurchase[],
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
    if (!card || purchase.isClosed || purchase.paidInstallments >= purchase.installments) continue;
    for (const inst of buildInstallmentPlan(purchase)) {
      if (inst.number <= purchase.paidInstallments || inst.dueDate.getTime() > toTime || inst.total.isZero()) continue;
      out.push({
        scheduledExpenseId: purchase.id,
        kind: 'CARD_INSTALLMENT',
        description: `${purchase.description} (cuota ${inst.number}/${purchase.installments})`,
        accountId: card.paymentAccountId,
        date: clamp(inst.dueDate),
        amount: inst.total,
      });
    }
  }

  // Las tarjetas empiezan en 2000 como pronto (ver CreditCard), así que nada vence antes.
  const beginning = new Date(Date.UTC(2000, 0, 1));
  for (const card of cards) {
    for (const fee of cardFeesDue(card, purchases, beginning, to)) {
      out.push({
        scheduledExpenseId: card.id,
        kind: 'CARD_FEE',
        description: `Manejo ${card.name} (${fee.month})`,
        accountId: card.paymentAccountId,
        date: clamp(fee.dueDate),
        amount: fee.amount,
      });
    }
  }

  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}
