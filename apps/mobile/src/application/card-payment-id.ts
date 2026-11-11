import type { CardPayment, CardPurchase, CreditCard } from '@finanzas/domain';
import type { CardPaymentInfo } from '@finanzas/ui';
import type { ServiceContext } from './support';

const INSTALLMENT = 'Este pago viene de una tarjeta. Para deshacerlo, usa «Deshacer último pago» en la tarjeta.';
const SETTLED = 'Este pago liquidó una compra y no se puede deshacer.';
const CLOSED = 'Esta compra ya se liquidó, así que este pago no se puede deshacer.';
const FEE = 'Para deshacer este pago, usa «Deshacer último pago de manejo» en la tarjeta.';
const ORPHAN = 'Este pago es de una tarjeta o compra que ya no existe: no se puede editar, solo eliminar desde el Historial.';
const CARD_PAYMENT = 'Este pago es parte de un pago de tarjeta. Para deshacerlo, usa «Deshacer último pago de la tarjeta».';

type CardPaymentRef =
  | { kind: 'installment' | 'settle'; purchaseId: string }
  | { kind: 'fee'; cardId: string; month: string }
  | { kind: 'cardPayment'; paymentId: string };

const PURCHASE_PAYMENT = /^c[pi]-(.+)-(\d+|liq)$/;
const FEE_PAYMENT = /^cf-(.+)-(\d{4}-\d{2})$/;
const CARD_PAYMENT_ID = /^pt-(.+)-(\d{2,})$/;

/**
 * Qué es un movimiento según su id fijo (`cp-<compra>-<k>`, `ci-<compra>-liq`, `cf-<tarjeta>-AAAA-MM`,
 * o `pt-<pago>-<nn>` para los de un pago único a la tarjeta).
 */
export function parseCardPaymentId(id: string): CardPaymentRef | null {
  const payment = CARD_PAYMENT_ID.exec(id);
  if (payment) return { kind: 'cardPayment', paymentId: payment[1]! };
  const fee = FEE_PAYMENT.exec(id);
  if (fee) return { kind: 'fee', cardId: fee[1]!, month: fee[2]! };
  const purchase = PURCHASE_PAYMENT.exec(id);
  if (purchase) return { kind: purchase[2] === 'liq' ? 'settle' : 'installment', purchaseId: purchase[1]! };
  return null;
}

/** Último mes con pago real de manejo, por tarjeta. */
export function latestFeeMonths(ids: readonly string[]): Map<string, string> {
  const latest = new Map<string, string>();
  for (const id of ids) {
    const ref = parseCardPaymentId(id);
    if (ref?.kind !== 'fee') continue;
    const current = latest.get(ref.cardId);
    if (current === undefined || ref.month > current) latest.set(ref.cardId, ref.month);
  }
  return latest;
}

/**
 * Función que dice si un movimiento es un pago de tarjeta y qué se puede hacer con él. Recuerda lo ya
 * consultado, así que una página con muchos pagos de la misma compra la lee una sola vez.
 */
export function cardPaymentDescriber(ctx: Pick<ServiceContext, 'cards' | 'purchases' | 'cardPayments'>): (id: string) => Promise<CardPaymentInfo | undefined> {
  const purchases = new Map<string, Promise<CardPurchase | null>>();
  const cards = new Map<string, Promise<CreditCard | null>>();
  const payments = new Map<string, Promise<CardPayment | null>>();
  const once = <T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> => {
    let found = cache.get(key);
    if (!found) {
      found = load();
      cache.set(key, found);
    }
    return found;
  };

  return async (id) => {
    const ref = parseCardPaymentId(id);
    if (!ref) return undefined;
    if (ref.kind === 'cardPayment') {
      // Si el pago ya no existe (se borró su tarjeta), el movimiento queda huérfano y se puede borrar.
      const payment = await once(payments, ref.paymentId, () => ctx.cardPayments.findById(ref.paymentId));
      return payment?.transactionIds.includes(id) ? { message: CARD_PAYMENT, canDelete: false } : { message: ORPHAN, canDelete: true };
    }
    if (ref.kind === 'fee') {
      const card = await once(cards, ref.cardId, () => ctx.cards.findById(ref.cardId));
      return card ? { message: FEE, canDelete: false } : { message: ORPHAN, canDelete: true };
    }
    const purchase = await once(purchases, ref.purchaseId, () => ctx.purchases.findById(ref.purchaseId));
    if (!purchase) return { message: ORPHAN, canDelete: true };
    if (ref.kind === 'settle') return { message: SETTLED, canDelete: false };
    return { message: purchase.isClosed ? CLOSED : INSTALLMENT, canDelete: false };
  };
}
