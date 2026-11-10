import { Money } from '../money/money';
import { assertDomain } from '../shared/domain-validation.error';
import { Allocation, CardPayment, createCardPayment, ExtraMode } from './card-payment';
import { CardPurchase } from './card-purchase';
import { cardDue, compareDue, DueItem, PurchaseBalance, purchaseBalances } from './card-due';
import { CreditCard, YearMonth } from './credit-card';
import { purchaseSchedule } from './purchase-schedule';

export interface AllocateOptions {
  /** No cambia el reparto; se guarda en el pago para recalcular las cuotas. */
  mode?: ExtraMode;
  /** Compra que recibe primero la plata de más. Si no se da: mayor tasa, luego la más antigua, luego el id. */
  extraPurchaseId?: string;
  purchases: readonly PurchaseBalance[];
}

/** `$1.234.567`, sin decimales. */
function pesos(amount: bigint): string {
  return `$${amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

function extraOrder(balances: readonly PurchaseBalance[], extraPurchaseId?: string): PurchaseBalance[] {
  const sorted = [...balances].sort(
    (a, b) =>
      b.purchase.monthlyRatePpm - a.purchase.monthlyRatePpm ||
      a.purchase.purchaseDate.getTime() - b.purchase.purchaseDate.getTime() ||
      a.purchase.id.localeCompare(b.purchase.id),
  );
  if (extraPurchaseId === undefined) return sorted;
  const chosen = sorted.findIndex((b) => b.purchase.id === extraPurchaseId);
  assertDomain(chosen >= 0, 'La compra elegida no está en esta tarjeta.');
  return [sorted[chosen], ...sorted.slice(0, chosen), ...sorted.slice(chosen + 1)];
}

/**
 * Reparte un pago: 1) lo vencido, del más antiguo al más nuevo; 2) lo del periodo, en el mismo orden
 * (en la misma fecha: manejo, interés, capital; luego la compra más antigua y su id); 3) la plata de más,
 * que pasa a la siguiente compra si cierra una. Las partes suman exactamente el pago.
 */
export function allocatePayment(due: readonly DueItem[], amount: Money, options: AllocateOptions): Allocation[] {
  assertDomain(amount.isPositive(), 'El pago debe ser mayor que cero.');
  const currency = amount.currency;
  const max = Money.sum([...due.map((i) => i.amount), ...options.purchases.map((b) => b.extraCapacity)], currency);
  assertDomain(!amount.greaterThan(max), `El máximo que puedes pagar es ${pesos(max.amount)}.`);
  const order = extraOrder(options.purchases, options.extraPurchaseId);

  const out = new Map<string, Allocation>();
  let rest = amount.amount;
  const take = (available: bigint): bigint => {
    const part = available < rest ? available : rest;
    rest -= part;
    return part;
  };

  const purchaseDates = new Map(options.purchases.map((b) => [b.purchase.id, b.purchase.purchaseDate.getTime()]));
  for (const item of [...due].sort(compareDue(purchaseDates))) {
    if (rest === 0n) break;
    const part = Money.of(take(item.amount.amount), currency);
    if (item.kind === 'FEE') {
      const key = `F:${item.month}`;
      const prev = out.get(key);
      out.set(key, { kind: 'FEE', month: item.month!, amount: prev?.kind === 'FEE' ? prev.amount.add(part) : part });
      continue;
    }
    const key = `I:${item.purchaseId}:${item.number}`;
    const prev = out.get(key);
    const base = prev?.kind === 'INSTALLMENT' ? prev : { interest: Money.zero(currency), capital: Money.zero(currency) };
    out.set(key, {
      kind: 'INSTALLMENT',
      purchaseId: item.purchaseId!,
      number: item.number!,
      interest: item.kind === 'INTEREST' ? base.interest.add(part) : base.interest,
      capital: item.kind === 'CAPITAL' ? base.capital.add(part) : base.capital,
    });
  }

  for (const balance of order) {
    if (rest === 0n) break;
    const part = take(balance.extraCapacity.amount);
    if (part > 0n) out.set(`E:${balance.purchase.id}`, { kind: 'EXTRA', purchaseId: balance.purchase.id, capital: Money.of(part, currency) });
  }
  return [...out.values()];
}

export interface PaymentOutcome {
  /** Cuotas que quedarían por pagar. */
  remainingInstallments: number;
  /** Valor de la próxima cuota (capital + interés); cero si no queda ninguna. */
  nextInstallment: Money;
}

export interface PaymentPreview {
  allocations: Allocation[];
  fees: { month: YearMonth; amount: Money }[];
  purchases: { purchaseId: string; interest: Money; capital: Money; extraCapital: Money }[];
  extraCapital: Money;
  /** Por cada compra que recibe plata de más: cómo quedaría terminando antes y bajando la cuota. */
  outcomes: { purchaseId: string; SHORTEN: PaymentOutcome; LOWER: PaymentOutcome }[];
}

function outcome(purchase: CardPurchase, payments: readonly CardPayment[], cutDay: number | undefined, on: Date, currency: string): PaymentOutcome {
  const pending = purchaseSchedule(purchase, payments, cutDay, on).filter((r) => r.remaining.isPositive());
  return { remainingInstallments: pending.length, nextInstallment: pending[0]?.remaining ?? Money.zero(currency) };
}

/** Desglose de un pago antes de confirmarlo: por compra, por manejo y, si hay plata de más, las dos opciones. */
export function paymentPreview(
  card: CreditCard,
  purchases: readonly CardPurchase[],
  payments: readonly CardPayment[],
  on: Date,
  amount: Money,
  options: { extraPurchaseId?: string } = {},
): PaymentPreview {
  const currency = amount.currency;
  const balances = purchaseBalances(card, purchases, payments, on);
  const allocations = allocatePayment(cardDue(card, purchases, payments, on), amount, { ...options, purchases: balances });

  const fees: PaymentPreview['fees'] = [];
  const byPurchase = new Map<string, PaymentPreview['purchases'][number]>();
  const entry = (purchaseId: string) => {
    let e = byPurchase.get(purchaseId);
    if (!e) {
      e = { purchaseId, interest: Money.zero(currency), capital: Money.zero(currency), extraCapital: Money.zero(currency) };
      byPurchase.set(purchaseId, e);
    }
    return e;
  };
  for (const a of allocations) {
    if (a.kind === 'FEE') fees.push({ month: a.month, amount: a.amount });
    else if (a.kind === 'EXTRA') entry(a.purchaseId).extraCapital = entry(a.purchaseId).extraCapital.add(a.capital);
    else {
      const e = entry(a.purchaseId);
      e.interest = e.interest.add(a.interest);
      e.capital = e.capital.add(a.capital);
    }
  }

  const extras = allocations.filter((a): a is Extract<Allocation, { kind: 'EXTRA' }> => a.kind === 'EXTRA');
  const own = payments.filter((p) => p.cardId === card.id);
  const simulate = (extraMode: ExtraMode): CardPayment[] => [
    ...own,
    createCardPayment({
      id: 'preview',
      cardId: card.id,
      seq: own.reduce((max, p) => Math.max(max, p.seq), 0) + 1,
      paidOn: on,
      fromAccountId: card.paymentAccountId,
      total: amount,
      allocations,
      extraMode,
      transactionIds: [],
    }),
  ];
  const outcomes: PaymentPreview['outcomes'] = [];
  if (extras.length > 0) {
    const shorten = simulate('SHORTEN');
    const lower = simulate('LOWER');
    for (const extra of extras) {
      const purchase = balances.find((b) => b.purchase.id === extra.purchaseId)!.purchase;
      outcomes.push({
        purchaseId: purchase.id,
        SHORTEN: outcome(purchase, shorten, card.cutDay, on, currency),
        LOWER: outcome(purchase, lower, card.cutDay, on, currency),
      });
    }
  }

  return {
    allocations,
    fees,
    purchases: [...byPurchase.values()],
    extraCapital: Money.sum(extras.map((e) => e.capital), currency),
    outcomes,
  };
}
