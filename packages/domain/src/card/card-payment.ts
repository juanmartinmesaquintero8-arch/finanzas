import { Money } from '../money/money';
import { startOfDayUTC } from '../shared/date';
import { assertDomain } from '../shared/domain-validation.error';
import { YearMonth } from './credit-card';

/** Qué hacer con la plata de más: terminar antes (misma cuota) o bajar la cuota (mismas cuotas). */
export type ExtraMode = 'SHORTEN' | 'LOWER';

/** Una parte del pago: una cuota (interés y capital separados), capital de más sobre una compra o un mes de manejo. */
export type Allocation =
  | { kind: 'INSTALLMENT'; purchaseId: string; number: number; interest: Money; capital: Money }
  | { kind: 'EXTRA'; purchaseId: string; capital: Money }
  | { kind: 'FEE'; month: YearMonth; amount: Money };

export interface CardPaymentProps {
  id: string;
  cardId: string;
  /** Orden del pago dentro de la tarjeta (entero ≥ 1). */
  seq: number;
  paidOn: Date;
  fromAccountId: string;
  total: Money;
  /** Presente si y solo si hay alguna asignación `EXTRA`. */
  extraMode?: ExtraMode;
  allocations: readonly Allocation[];
  transactionIds: readonly string[];
}

/** Evento: un pago a la tarjeta con su reparto. El estado de las cuotas se calcula a partir de estos eventos. */
export type CardPayment = Readonly<CardPaymentProps>;

const YEAR_MONTH = /^(20\d{2}|2100)-(0[1-9]|1[0-2])$/;

/** Valor total de una asignación. */
export function allocationAmount(a: Allocation): Money {
  if (a.kind === 'INSTALLMENT') return a.interest.add(a.capital);
  if (a.kind === 'EXTRA') return a.capital;
  return a.amount;
}

function assertAllocation(a: Allocation): void {
  const positive = 'Cada parte del pago debe ser mayor que cero.';
  if (a.kind === 'INSTALLMENT') {
    assertDomain(Number.isInteger(a.number) && a.number >= 1, 'La cuota indicada no es válida');
    assertDomain(!a.interest.isNegative() && !a.capital.isNegative() && allocationAmount(a).isPositive(), positive);
  } else if (a.kind === 'EXTRA') {
    assertDomain(a.capital.isPositive(), positive);
  } else {
    assertDomain(YEAR_MONTH.test(a.month), 'El mes de manejo debe tener formato AAAA-MM');
    assertDomain(a.amount.isPositive(), positive);
  }
}

/** Crea un pago validando sus invariantes: el reparto suma exactamente el total y nada va en cero. */
export function createCardPayment(props: CardPaymentProps): CardPayment {
  assertDomain(Number.isInteger(props.seq) && props.seq >= 1, 'El orden del pago debe ser un entero desde 1');
  assertDomain(props.paidOn instanceof Date && !Number.isNaN(props.paidOn.getTime()), 'La fecha del pago no es válida');
  assertDomain(props.total.isPositive(), 'El pago debe ser mayor que cero.');
  props.allocations.forEach(assertAllocation);
  const sum = Money.sum(props.allocations.map(allocationAmount), props.total.currency);
  assertDomain(sum.equals(props.total), 'El reparto del pago no suma el total.');
  const hasExtra = props.allocations.some((a) => a.kind === 'EXTRA');
  if (hasExtra) assertDomain(props.extraMode === 'SHORTEN' || props.extraMode === 'LOWER', 'Elige qué hacer con la plata de más.');
  else assertDomain(props.extraMode === undefined, 'Solo se elige qué hacer con la plata de más cuando la hay.');
  return Object.freeze({
    ...props,
    paidOn: startOfDayUTC(props.paidOn),
    allocations: Object.freeze([...props.allocations]),
    transactionIds: Object.freeze([...props.transactionIds]),
  });
}

/**
 * La fecha de un pago no puede ser futura ni anterior al último pago de esa tarjeta (el mismo día sí).
 * `paidOn` y `today` deben ser el día calendario de Colombia (America/Bogota) como fecha UTC a medianoche:
 * aquí solo se compara el día UTC.
 */
export function validatePaymentDate(paidOn: Date, cardPayments: readonly CardPayment[], today: Date): void {
  const day = startOfDayUTC(paidOn).getTime();
  assertDomain(day <= startOfDayUTC(today).getTime(), 'La fecha del pago no puede ser futura.');
  const last = cardPayments.reduce((max, p) => Math.max(max, startOfDayUTC(p.paidOn).getTime()), Number.NEGATIVE_INFINITY);
  assertDomain(day >= last, 'La fecha del pago no puede ser anterior al último pago de esta tarjeta.');
}
