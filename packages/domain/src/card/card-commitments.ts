import { Money } from '../money/money';
import { Commitment } from '../projection/projection-engine';
import { startOfDayUTC } from '../shared/date';
import { CardPurchase } from './card-purchase';
import { cycleMonthIndex, feeDueDate, monthIndexOf } from './billing-cycle';
import { CreditCard, YearMonth } from './credit-card';
import { buildInstallmentPlan } from './installments';

export interface CardFeeDue {
  cardId: string;
  /** Mes que se cobra (`YYYY-MM`); vence el día de pago del mes siguiente. */
  month: YearMonth;
  dueDate: Date;
  amount: Money;
}

const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** '2026-11' -> 'noviembre 2026'. */
function monthInWords(month: YearMonth): string {
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

function parseMonth(month: YearMonth): number {
  return Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1);
}

function formatMonth(index: number): YearMonth {
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

function purchaseMonths(cardId: string, purchases: readonly CardPurchase[], cutDay?: number): Set<number> {
  const months = new Set<number>();
  for (const p of purchases) {
    if (p.cardId === cardId) months.add(cutDay === undefined ? monthIndexOf(p.purchaseDate) : cycleMonthIndex(p.purchaseDate, cutDay));
  }
  return months;
}

/**
 * Cuotas de manejo de la tarjeta que vencen en [from, to] (por fecha de vencimiento, ambos incluidos).
 * La del mes M vence el día de pago de M + 1, para M >= feeStartMonth y M > feesSettledThrough.
 * Con día de corte, M es el ciclo de facturación (del día siguiente al corte anterior hasta el corte de M)
 * y vence el primer día de pago posterior a ese corte.
 * ON_MOVEMENT exige una compra de esta tarjeta con fecha en M (en su ciclo, si hay corte); pagar cuotas no cuenta como movimiento.
 */
export function cardFeesDue(card: CreditCard, purchases: readonly CardPurchase[], from: Date, to: Date): CardFeeDue[] {
  if (card.fee.kind === 'NONE') return [];
  const fromTime = startOfDayUTC(from).getTime();
  const toTime = startOfDayUTC(to).getTime();
  let first = parseMonth(card.feeStartMonth);
  if (card.feesSettledThrough !== undefined) first = Math.max(first, parseMonth(card.feesSettledThrough) + 1);
  // Mes más tardío cuyo vencimiento puede caer en `to` (el mes siguiente sin corte; el mismo mes con corte).
  const last = monthIndexOf(startOfDayUTC(to)) - (card.cutDay === undefined ? 1 : 0);
  const withMovement = card.fee.kind === 'ON_MOVEMENT' ? purchaseMonths(card.id, purchases, card.cutDay) : undefined;
  const result: CardFeeDue[] = [];
  for (let m = first; m <= last; m++) {
    if (withMovement && !withMovement.has(m)) continue;
    const dueDate = feeDueDate(m, card.dueDay, card.cutDay);
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
        description: `Manejo ${card.name} (${monthInWords(fee.month)})`,
        accountId: card.paymentAccountId,
        date: clamp(fee.dueDate),
        amount: fee.amount,
      });
    }
  }

  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}
