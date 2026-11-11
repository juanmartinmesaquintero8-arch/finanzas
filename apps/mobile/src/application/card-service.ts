import {
  CardPurchase,
  CreditCard,
  InterestRate,
  Money,
  TransactionFactory,
  UnknownAccountError,
  buildInstallmentPlan,
  billingMonthOf,
  cardDebtWithPayments,
  cardDue,
  purchaseBalances,
  purchaseSchedule,
  type Allocation,
  type DueItem,
  createCardPayment,
  maxPayment,
  paymentPreview,
  validatePaymentDate,
  type CardPayment,
  type PaymentPreview,
  cardFeesDue,
  firstDueDateFor,
  isMonthKey,
  looksLikeAnnualAsMonthly,
  parseRatePercent,
  planSummary,
  settleOffer,
  type CardFee,
  type Installment,
  type Transaction,
} from '@finanzas/domain';
import {
  addMonthsISO,
  endOfMonthISO,
  formatMonthLong,
  monthName,
  todayISO,
  type ActionResult,
  type CardInput,
  type CardPaymentInput,
  type CardPaymentPreview,
  type CardPaymentPreviewInput,
  type CardPaymentPreviewResult,
  type CardPaymentShortcuts,
  CARD_CHANGED,
  type CardView,
  type FeeImpact,
  type PayFeeInput,
  type PayInstallmentInput,
  type PurchaseInput,
  type PurchasePreview,
  type PurchasePreviewResult,
  type PurchaseView,
  type RateBasis,
  type RateCheck,
  type InstallmentView,
  type SettleInput,
} from '@finanzas/ui';
import { LegacyLockedError } from '@/data/idb-ledger-store';
import { latestFeeMonths } from './card-payment-id';
import { INT64_MAX, MAX_CARD_ID, MAX_CARD_PAYMENTS, MAX_CARD_PURCHASES, MAX_CREDIT_CARDS, MAX_TEXT } from './limits';
import { AppError, CURRENCY, assertTextLength, isoDay, notFound, parseDay, parseMoney, toMessage, writeAction, type ServiceContext } from './support';

/** Categoría de los gastos que no son capital: intereses y cuotas de manejo. */
const INTEREST_CATEGORY = 'Intereses y manejo';
const TOO_BIG = 'El monto es demasiado grande.';
const BEGINNING = new Date(Date.UTC(2000, 0, 1));

/** Lo que una compra toma de su tarjeta. */
type CardTerms = Pick<CardView, 'id' | 'dueDay' | 'cutDay' | 'monthlyRatePpm'>;

/** Lo ya pactado en una compra: editarla no lo cambia por lo que hoy diga la tarjeta. */
type AgreedTerms = Pick<PurchaseView, 'monthlyRatePpm' | 'purchaseDate' | 'firstDueDate' | 'dueDayAnchor'>;

const NO_FEE_IMPACT: FeeImpact = { lostCount: 0, lostAmount: '0', changedCount: 0 };
const LATE_PURCHASE = 'Esa compra es de un mes con manejo ya pagado, así que no se generó una cuota nueva.';

/** Los pagos y deshacer por compra o por manejo no se mezclan con el pago único de la tarjeta. */
const LEGACY_LOCKED = 'Esta tarjeta ya usa el pago único. Para corregir, usa «Deshacer último pago de la tarjeta».';
const BAD_PAYMENT_ID = 'No pudimos registrar el pago. Cierra el formulario y ábrelo de nuevo.';
const OTHER_VALUES = 'Ya registraste un pago con otros valores. Cierra el formulario y revisa el historial de la tarjeta.';
const NOTHING_TO_UNDO = 'Esta tarjeta no tiene pagos para deshacer.';
const CUT_LOCKED = 'Esta tarjeta ya tiene pagos con el pago único. Para cambiar el día de corte, primero deshazlos con «Deshacer último pago de la tarjeta».';
/** El id del pago lo crea el cliente; con él, `pt-<id>-<nn>` siempre cabe en un id válido de movimiento. */
const PAYMENT_ID = new RegExp(`^[A-Za-z0-9_-]{1,${MAX_CARD_ID}}$`);
const LOCKED_PURCHASE = 'Esta compra ya tiene cuotas pagadas: solo puedes cambiar la descripción y la categoría.';

/** ¿Algún pago de tarjeta reparte plata a esta compra? */
const touchesPurchase = (payments: readonly CardPayment[], purchaseId: string): boolean =>
  payments.some((p) => p.allocations.some((a) => a.kind !== 'FEE' && a.purchaseId === purchaseId));

const lastSeqOf = (payments: readonly CardPayment[]): number => payments.reduce((max, p) => Math.max(max, p.seq), 0);

/** Con el año entre 2000 y 2100 la fecha se guarda y se recupera siempre igual. */
function parseCardDate(raw: string): Date {
  const date = parseDay(raw);
  const year = date.getUTCFullYear();
  if (year < 2000 || year > 2100) throw new AppError('La fecha debe estar entre el año 2000 y el 2100.');
  return date;
}

/** Arma la compra validando textos, fechas y que todas sus cifras quepan en lo que se guarda. */
function buildPurchase(id: string, input: PurchaseInput, card: CardTerms, existing?: AgreedTerms): CardPurchase {
  assertTextLength('description', input.description);
  assertTextLength('category', input.category);
  const purchaseDate = parseCardDate(input.purchaseDate);
  const firstDueDate = parseCardDate(input.firstDueDate);
  const sameDates = existing && existing.purchaseDate === isoDay(purchaseDate) && existing.firstDueDate === isoDay(firstDueDate);
  const isSuggested = firstDueDateFor(purchaseDate, card.dueDay, card.cutDay ?? undefined).getTime() === firstDueDate.getTime();
  const purchase = CardPurchase.create({
    id,
    cardId: input.cardId,
    description: input.description,
    category: input.category,
    amount: parseMoney(input.amount),
    installments: input.installments,
    purchaseDate,
    firstDueDate,
    monthlyRatePpm: input.withoutInterest ? 0 : (existing?.monthlyRatePpm || card.monthlyRatePpm),
    paidInstallments: input.paidInstallments ?? 0,
    dueDayAnchor: sameDates ? (existing.dueDayAnchor ?? undefined) : isSuggested ? card.dueDay : undefined,
  });
  if (planSummary(buildInstallmentPlan(purchase)).totalToPay.amount > INT64_MAX) throw new AppError(TOO_BIG);
  return purchase;
}

function toInstallmentView(i: Installment): InstallmentView {
  return { number: i.number, dueDate: isoDay(i.dueDate), capital: i.capital.amount.toString(), interest: i.interest.amount.toString(), total: i.total.amount.toString() };
}

/** Vista previa de lo que se va a confirmar. Pura: no lee ni escribe nada. */
export function previewPurchase(card: CardTerms, input: PurchaseInput, agreed?: AgreedTerms): PurchasePreviewResult {
  try {
    const purchase = buildPurchase('vista-previa', input, card, agreed);
    const pending = buildInstallmentPlan(purchase).slice(purchase.paidInstallments);
    const sum = (pick: (i: Installment) => Money) => Money.sum(pending.map(pick), CURRENCY).amount.toString();
    const preview: PurchasePreview = {
      totalCount: purchase.installments,
      remainingCount: pending.length,
      installments: pending.map(toInstallmentView),
      totalInterest: sum((i) => i.interest),
      totalToPay: sum((i) => i.total),
    };
    return { ok: true, preview };
  } catch (e) {
    return { ok: false, error: toMessage(e) };
  }
}

/** Cabe en lo que se guarda: la descripción de un pago nunca debe superar el máximo de texto. */
function fitDescription(base: string, suffix: string): string {
  return `${base.slice(0, MAX_TEXT.description - suffix.length)}${suffix}`;
}

function formatRate(ppm: number): string {
  const whole = Math.floor(ppm / 10_000);
  const fraction = String(ppm % 10_000).padStart(4, '0').replace(/0+$/, '');
  return fraction ? `${whole},${fraction}` : String(whole);
}

function rateOf(input: Pick<CardInput, 'rateBasis' | 'rateText'>): InterestRate | undefined {
  if (!input.rateBasis) return undefined;
  return InterestRate.create({ basis: input.rateBasis, ppm: parseRatePercent(input.rateText ?? '') });
}

function feeOf(input: Pick<CardInput, 'feeKind' | 'feeAmount'>): CardFee {
  if (input.feeKind === 'NONE') return { kind: 'NONE' };
  if (!input.feeAmount) throw new AppError('Escribe cuánto cobra de manejo.');
  return { kind: input.feeKind, amount: parseMoney(input.feeAmount) };
}

/**
 * Cambiar el manejo no cobra de golpe lo que antes no se cobraba: si empieza a cobrarse (o a cobrarse
 * todos los meses), cuenta desde el mes actual.
 */
function nextFeeStart(existing: CreditCard, fee: CardFee, currentMonth: string): string {
  const startsCharging = fee.kind !== 'NONE' && existing.fee.kind === 'NONE';
  const becomesMonthly = fee.kind === 'FIXED_MONTHLY' && existing.fee.kind === 'ON_MOVEMENT';
  return startsCharging || becomesMonthly ? currentMonth : existing.feeStartMonth;
}

function byName(a: CreditCard, b: CreditCard): number {
  return a.name.localeCompare(b.name, 'es');
}

/** Primero lo que aún se debe, por la próxima fecha; después lo ya terminado. */
function byPendingFirst(a: PurchaseView, b: PurchaseView): number {
  if (!!a.next !== !!b.next) return a.next ? -1 : 1;
  return (a.next?.dueDate ?? a.firstDueDate).localeCompare(b.next?.dueDate ?? b.firstDueDate);
}

const isOpen = (p: CardPurchase): boolean => !p.isClosed && p.paidInstallments < p.installments;

/**
 * Vista de una compra. Sin pagos únicos en la tarjeta, la cuota sale del plan como siempre; con pagos únicos,
 * del estado calculado con esos pagos (parciales y de más) al día de hoy.
 */
function toPurchaseView(p: CardPurchase, card: CreditCard, payments: readonly CardPayment[], today: Date): PurchaseView {
  if (payments.length === 0 || p.isClosed) {
    const next = isOpen(p) ? buildInstallmentPlan(p)[p.paidInstallments]! : null;
    return { ...purchaseFields(p), paidCount: p.paidInstallments, installmentCount: p.installments, next: next && toInstallmentView(next), settle: settleOf(p) };
  }
  const schedule = purchaseSchedule(p, payments, card.cutDay, today);
  const row = schedule.find((r) => r.remaining.isPositive());
  const next: InstallmentView | null = row
    ? {
        number: row.number,
        dueDate: isoDay(row.dueDate),
        capital: row.capitalDue.subtract(row.capitalPaid).amount.toString(),
        interest: row.interestDue.subtract(row.interestPaid).amount.toString(),
        total: row.remaining.amount.toString(),
      }
    : null;
  const paidCount = schedule.filter((r) => !r.remaining.isPositive()).length;
  return { ...purchaseFields(p), paidCount, installmentCount: schedule.length, next, settle: null };
}

function settleOf(p: CardPurchase): PurchaseView['settle'] {
  const offer = isOpen(p) ? settleOffer(p) : null;
  return offer && { capital: offer.capital.amount.toString(), interest: offer.interest.amount.toString(), total: offer.total.amount.toString() };
}

function purchaseFields(p: CardPurchase): Omit<PurchaseView, 'next' | 'settle' | 'paidCount' | 'installmentCount'> {
  return {
    id: p.id,
    cardId: p.cardId,
    description: p.description,
    category: p.category ?? null,
    amount: p.amount.amount.toString(),
    installments: p.installments,
    paidInstallments: p.paidInstallments,
    purchaseDate: isoDay(p.purchaseDate),
    firstDueDate: isoDay(p.firstDueDate),
    monthlyRatePpm: p.monthlyRatePpm,
    closedOn: p.closedOn ? isoDay(p.closedOn) : null,
    dueDayAnchor: p.dueDayAnchor ?? null,
  };
}

/** Cuotas de manejo hasta `horizon` con lo que aún falta de cada una (lo pagado con pagos únicos se descuenta). */
function feesStillOwed(card: CreditCard, purchases: readonly CardPurchase[], payments: readonly CardPayment[], horizon: Date): CardView['pendingFees'] {
  const paid = new Map<string, bigint>();
  for (const p of payments) for (const a of p.allocations) if (a.kind === 'FEE') paid.set(a.month, (paid.get(a.month) ?? 0n) + a.amount.amount);
  return cardFeesDue(card, purchases, BEGINNING, horizon)
    .map((f) => ({ month: f.month, dueDate: isoDay(f.dueDate), amount: (f.amount.amount - (paid.get(f.month) ?? 0n)).toString() }))
    .filter((f) => BigInt(f.amount) > 0n);
}

/** Lo del periodo (aún no vencido) que el pago no cubre, y la fecha de lo primero que queda sin cubrir. */
function dueSoonAfter(due: readonly DueItem[], afterOverdue: bigint): CardPaymentPreview['dueSoon'] {
  let rest = afterOverdue;
  let left = 0n;
  let date: Date | null = null;
  for (const item of due.filter((i) => !i.overdue)) {
    const covered = item.amount.amount < rest ? item.amount.amount : rest;
    rest -= covered;
    if (covered < item.amount.amount) {
      left += item.amount.amount - covered;
      date ??= item.dueDate;
    }
  }
  return date ? { amount: left.toString(), dueDate: isoDay(date) } : null;
}

/** Firma estable de un reparto: si cambia algo de lo que se mostró, cambia la firma. */
function signatureOf(total: Money, paidOn: Date, allocations: readonly Allocation[]): string {
  const parts = allocations.map((a) =>
    a.kind === 'FEE'
      ? `F:${a.month}:${a.amount.amount}`
      : a.kind === 'EXTRA'
        ? `E:${a.purchaseId}:${a.capital.amount}`
        : `I:${a.purchaseId}:${a.number}:${a.interest.amount}:${a.capital.amount}`,
  );
  return [total.amount.toString(), isoDay(paidOn), ...parts].join('|');
}

/** La próxima fecha con algo por pagar y la suma de las cuotas que caen ese día. */
function nextDue(purchases: readonly PurchaseView[]): CardView['next'] {
  const pending = purchases.flatMap((p) => (p.next && BigInt(p.next.total) > 0n ? [p.next] : []));
  if (pending.length === 0) return null;
  const date = pending.reduce((min, i) => (i.dueDate < min ? i.dueDate : min), pending[0]!.dueDate);
  const amount = pending.filter((i) => i.dueDate === date).reduce((sum, i) => sum + BigInt(i.total), 0n);
  return { amount: amount.toString(), date };
}

const agreedOf = (p: CardPurchase): AgreedTerms => ({
  monthlyRatePpm: p.monthlyRatePpm,
  purchaseDate: isoDay(p.purchaseDate),
  firstDueDate: isoDay(p.firstDueDate),
  dueDayAnchor: p.dueDayAnchor ?? null,
});

/** El mes anterior a `month` ('YYYY-MM'). */
function previousMonth(month: string): string {
  return addMonthsISO(`${month}-01`, -1).slice(0, 7);
}


/** Fin del mes siguiente: hasta ahí se listan las cuotas de manejo pendientes. */
function feeHorizon(today: string): Date {
  return parseDay(endOfMonthISO(addMonthsISO(today, 1)));
}

export class CardService {
  constructor(private readonly ctx: ServiceContext) {}

  async list(): Promise<CardView[]> {
    const [cards, purchases, feeIds, payments] = await Promise.all([
      this.ctx.cards.findAll(),
      this.ctx.purchases.findAll(),
      this.ctx.ledger.feePaymentIds(),
      this.ctx.cardPayments.findAll(),
    ]);
    const todayText = todayISO(this.ctx.now());
    const horizon = feeHorizon(todayText);
    const lastPaid = latestFeeMonths(feeIds);
    return [...cards].sort(byName).map((card) => this.toCardView(card, purchases, payments, parseDay(todayText), horizon, lastPaid.get(card.id) ?? null));
  }

  private toCardView(card: CreditCard, purchases: readonly CardPurchase[], payments: readonly CardPayment[], today: Date, horizon: Date, lastPaidFeeMonth: string | null): CardView {
    const own = purchases.filter((p) => p.cardId === card.id);
    const ownPayments = payments.filter((p) => p.cardId === card.id).sort((a, b) => a.seq - b.seq);
    const views = own.map((p) => toPurchaseView(p, card, ownPayments, today)).sort(byPendingFirst);
    const last = ownPayments[ownPayments.length - 1];
    const overdue = cardDue(card, own, ownPayments, today).filter((i) => i.overdue);
    return {
      id: card.id,
      name: card.name,
      dueDay: card.dueDay,
      cutDay: card.cutDay ?? null,
      paymentAccountId: card.paymentAccountId,
      feeKind: card.fee.kind,
      feeAmount: card.fee.kind === 'NONE' ? null : card.fee.amount.amount.toString(),
      rateBasis: card.rate?.basis ?? null,
      rateText: card.rate ? formatRate(card.rate.ppm) : null,
      monthlyRatePpm: card.rate?.monthlyPpm ?? 0,
      chargesInterest: !!card.rate,
      debt: cardDebtWithPayments([card], own, payments, CURRENCY).amount.toString(),
      next: nextDue(views),
      purchases: views,
      pendingFees: feesStillOwed(card, purchases, ownPayments, horizon),
      lastPaidFeeMonth,
      overdue: Money.sum(overdue.map((i) => i.amount), CURRENCY).amount.toString(),
      lastCardPayment: last ? { id: last.id, total: last.total.amount.toString(), paidOn: isoDay(last.paidOn) } : null,
    };
  }

  /** Para Inicio: capital pendiente en todas las tarjetas, con los pagos aplicados. Es informativo: no se resta del Saldo Real. */
  async debtSummary(): Promise<{ hasCards: boolean; debt: string }> {
    const [cards, purchases, payments] = await Promise.all([this.ctx.cards.findAll(), this.ctx.purchases.findAll(), this.ctx.cardPayments.findAll()]);
    return { hasCards: cards.length > 0, debt: cardDebtWithPayments(cards, purchases, payments, CURRENCY).amount.toString() };
  }

  /** Revisa la tasa mientras se escribe: lo que la bloquea y lo que solo merece una advertencia. */
  checkRate(text: string, basis: RateBasis): RateCheck {
    try {
      const rate = InterestRate.create({ basis, ppm: parseRatePercent(text) });
      return looksLikeAnnualAsMonthly(rate) ? { warning: true } : {};
    } catch (e) {
      return { error: toMessage(e) };
    }
  }

  suggestFirstDueDate(card: Pick<CardView, 'dueDay' | 'cutDay'>, purchaseDate: string): string | null {
    if (!purchaseDate) return null;
    try {
      return isoDay(firstDueDateFor(parseDay(purchaseDate), card.dueDay, card.cutDay ?? undefined));
    } catch {
      return null;
    }
  }

  previewPurchase(card: CardTerms, input: PurchaseInput, agreed?: AgreedTerms): PurchasePreviewResult {
    return previewPurchase(card, input, agreed);
  }

  /** Qué cuotas de manejo sin pagar se perderían o cambiarían al guardar estos datos de la tarjeta. */
  async cardChangeImpact(cardId: string, input: CardInput): Promise<FeeImpact> {
    const existing = await this.ctx.cards.findById(cardId);
    if (!existing) return NO_FEE_IMPACT;
    let after: CreditCard;
    try {
      after = this.buildCard(cardId, input, nextFeeStart(existing, feeOf(input), this.currentMonth(input.cutDay)), existing.feesSettledThrough);
    } catch {
      return NO_FEE_IMPACT; // Datos inválidos: los rechaza el guardado, con su propio mensaje.
    }
    const purchases = await this.ctx.purchases.findByCard(cardId);
    return this.compareFees(existing, purchases, after, purchases);
  }

  /** Qué cuotas de manejo sin pagar se perderían al borrar esta compra. */
  purchaseRemovalImpact(purchaseId: string): Promise<FeeImpact> {
    return this.purchaseImpact(purchaseId, () => null);
  }

  /** Qué cuotas de manejo sin pagar se perderían si la compra pasa a tener estos datos. */
  purchaseChangeImpact(purchaseId: string, input: PurchaseInput): Promise<FeeImpact> {
    return this.purchaseImpact(purchaseId, (p) => CardPurchase.create({ ...p.toProps(), purchaseDate: parseCardDate(input.purchaseDate), firstDueDate: parseCardDate(input.firstDueDate) }));
  }

  private async purchaseImpact(purchaseId: string, change: (p: CardPurchase) => CardPurchase | null): Promise<FeeImpact> {
    const purchase = await this.ctx.purchases.findById(purchaseId);
    const card = purchase && (await this.ctx.cards.findById(purchase.cardId));
    if (!purchase || !card) return NO_FEE_IMPACT;
    let changed: CardPurchase | null;
    try {
      changed = change(purchase);
    } catch {
      return NO_FEE_IMPACT;
    }
    const all = await this.ctx.purchases.findByCard(card.id);
    const after = all.filter((p) => p.id !== purchaseId).concat(changed ?? []);
    return this.compareFees(card, all, card, after);
  }

  private compareFees(before: CreditCard, beforePurchases: readonly CardPurchase[], after: CreditCard, afterPurchases: readonly CardPurchase[]): FeeImpact {
    const horizon = feeHorizon(todayISO(this.ctx.now()));
    const next = new Map(cardFeesDue(after, afterPurchases, BEGINNING, horizon).map((f) => [f.month, { amount: f.amount.amount, dueDate: isoDay(f.dueDate) }]));
    const cutChanged = before.cutDay !== after.cutDay;
    let lostCount = 0;
    let lostAmount = 0n;
    let changedCount = 0;
    let movedCount = 0;
    const seen = new Set<string>();
    for (const fee of cardFeesDue(before, beforePurchases, BEGINNING, horizon)) {
      seen.add(fee.month);
      const upcoming = next.get(fee.month);
      if (upcoming === undefined) {
        lostCount += 1;
        lostAmount += fee.amount.amount;
      } else if (upcoming.amount !== fee.amount.amount) changedCount += 1;
      else if (cutChanged && upcoming.dueDate !== isoDay(fee.dueDate)) movedCount += 1;
    }
    const impact: FeeImpact = { lostCount, lostAmount: lostAmount.toString(), changedCount };
    if (!cutChanged) return impact;
    let newCount = 0;
    let newAmount = 0n;
    for (const [month, upcoming] of next) {
      if (seen.has(month)) continue;
      newCount += 1;
      newAmount += upcoming.amount;
    }
    if (movedCount > 0) impact.movedCount = movedCount;
    if (newCount > 0) {
      impact.newCount = newCount;
      impact.newAmount = newAmount.toString();
    }
    return impact;
  }

  /** El mes de facturación abierto hoy: el calendario sin corte; con corte, el ciclo que aún no ha cerrado. */
  private currentMonth(cutDay?: number): string {
    return billingMonthOf(parseDay(todayISO(this.ctx.now())), cutDay);
  }

  /** Una compra nueva en un mes ya cerrado no genera manejo (solo aplica si cobra por movimiento y ese mes no tenía compras). */
  private latePurchaseNotice(card: CreditCard, others: readonly CardPurchase[], purchase: CardPurchase): string | undefined {
    if (card.fee.kind !== 'ON_MOVEMENT' || card.feesSettledThrough === undefined) return undefined;
    const month = billingMonthOf(purchase.purchaseDate, card.cutDay);
    if (month > card.feesSettledThrough || month < card.feeStartMonth) return undefined;
    return others.some((p) => billingMonthOf(p.purchaseDate, card.cutDay) === month) ? undefined : LATE_PURCHASE;
  }

  createCard(input: CardInput): Promise<ActionResult> {
    return writeAction(this.ctx, async () => {
      if ((await this.ctx.cards.findAll()).length >= MAX_CREDIT_CARDS) throw new AppError(`Llegaste al máximo de ${MAX_CREDIT_CARDS} tarjetas.`);
      const card = this.buildCard(this.ctx.newId(), input, this.currentMonth(input.cutDay));
      await this.assertAccount(input.paymentAccountId);
      await this.ctx.cards.save(card);
    });
  }

  /** Conserva lo ya pagado; la tasa nueva solo aplica a las compras que vengan después. */
  updateCard(id: string, input: CardInput): Promise<ActionResult> {
    return writeAction(this.ctx, async () => {
      const existing = await this.requireCard(id);
      const feeStart = nextFeeStart(existing, feeOf(input), this.currentMonth(input.cutDay));
      const card = this.buildCard(id, input, feeStart, existing.feesSettledThrough);
      // El corte fija el interés de cada cuota: cambiarlo descuadraría lo ya repartido en los pagos únicos.
      if (card.cutDay !== existing.cutDay && (await this.ctx.cardPayments.countByCard(id)) > 0) throw new AppError(CUT_LOCKED);
      await this.assertAccount(input.paymentAccountId);
      await this.ctx.cards.save(card);
    });
  }

  /** Borra la tarjeta, sus compras y sus pagos únicos; los movimientos reales quedan en el historial. */
  removeCard(id: string): Promise<ActionResult> {
    return writeAction(this.ctx, async () => {
      await this.requireCard(id);
      await this.ctx.ledger.deleteCard(id);
    });
  }

  addPurchase(input: PurchaseInput): Promise<ActionResult> {
    return writeAction(this.ctx, async () => {
      if ((await this.ctx.purchases.findAll()).length >= MAX_CARD_PURCHASES) {
        throw new AppError(`Llegaste al máximo de ${MAX_CARD_PURCHASES.toLocaleString('es-CO')} compras con tarjeta.`);
      }
      const card = await this.requireCard(input.cardId);
      const purchase = buildPurchase(this.ctx.newId(), input, this.termsOf(card));
      const others = await this.ctx.purchases.findByCard(card.id);
      await this.ctx.purchases.save(purchase);
      return this.latePurchaseNotice(card, others, purchase);
    });
  }

  /** Con cuotas pagadas o la compra cerrada, solo cambian la descripción y la categoría. */
  updatePurchase(id: string, input: PurchaseInput): Promise<ActionResult> {
    return writeAction(this.ctx, async () => {
      const existing = await this.requirePurchase(id);
      if (input.cardId !== existing.cardId) throw new AppError('Una compra no se puede pasar a otra tarjeta.');
      const paid = existing.paidInstallments > 0 || existing.isClosed || touchesPurchase(await this.ctx.cardPayments.findByCard(existing.cardId), id);
      if (paid) {
        this.assertLockedFieldsUnchanged(existing, input);
        assertTextLength('description', input.description);
        assertTextLength('category', input.category);
        await this.ctx.purchases.save(CardPurchase.create({ ...existing.toProps(), description: input.description, category: input.category }));
        return;
      }
      const card = await this.requireCard(existing.cardId);
      const purchase = buildPurchase(id, input, this.termsOf(card), agreedOf(existing));
      const others = (await this.ctx.purchases.findByCard(card.id)).filter((p) => p.id !== id);
      await this.ctx.purchases.save(purchase);
      return billingMonthOf(purchase.purchaseDate, card.cutDay) === billingMonthOf(existing.purchaseDate, card.cutDay) ? undefined : this.latePurchaseNotice(card, others, purchase);
    });
  }

  /** Borra la deuda restante; los pagos reales que ya se hicieron quedan. */
  removePurchase(id: string): Promise<ActionResult> {
    return writeAction(this.ctx, async () => {
      await this.requirePurchase(id);
      await this.ctx.purchases.delete(id);
    });
  }

  /** Paga la siguiente cuota, en orden, en una sola escritura. */
  payInstallment(purchaseId: string, input: PayInstallmentInput): Promise<ActionResult> {
    return writeAction(this.ctx, async () => {
      const purchase = await this.requirePurchase(purchaseId);
      await this.assertLegacyAllowed(purchase.cardId);
      if (purchase.isClosed) throw new AppError('Esta compra ya está liquidada.');
      if (purchase.paidInstallments >= purchase.installments) {
        if (input.installment !== undefined && input.installment <= purchase.paidInstallments) return;
        throw new AppError('Esta compra ya está pagada.');
      }
      const number = purchase.paidInstallments + 1;
      if (input.installment !== undefined && input.installment < number) return; // Segundo toque de una cuota ya pagada.
      if (input.installment !== undefined && input.installment > number) throw new AppError('Esa cuota todavía no es la siguiente. Revisa la lista.');

      const plan = buildInstallmentPlan(purchase)[number - 1]!;
      const interest = input.interest === undefined ? plan.interest : this.parseInterest(input.interest);
      const paidOn = parseCardDate(input.paidOn);
      if (paidOn.getTime() < purchase.purchaseDate.getTime()) throw new AppError('El pago no puede ser anterior a la compra.');
      await this.assertAccount(input.fromAccountId);
      const suffix = ` (cuota ${number}/${purchase.installments})`;
      const put = this.payments(purchase, input.fromAccountId, paidOn, {
        capitalId: `cp-${purchase.id}-${number}`,
        capital: plan.capital,
        capitalDescription: fitDescription(purchase.description, suffix),
        interestId: `ci-${purchase.id}-${number}`,
        interest,
        interestDescription: fitDescription(`Intereses ${purchase.description}`, suffix),
      });
      await this.legacyWrite(() => this.ctx.ledger.writeCardPayment(purchase, purchase.markPaid(number), put));
    });
  }

  /** Deshace la última cuota pagada: borra sus movimientos y resta una, en una sola escritura. */
  undoLastPayment(purchaseId: string, input: { installment?: number } = {}): Promise<ActionResult> {
    return writeAction(this.ctx, async () => {
      const purchase = await this.requirePurchase(purchaseId);
      await this.assertLegacyAllowed(purchase.cardId);
      if (purchase.isClosed) throw new AppError('Esta compra ya está liquidada, así que no se puede deshacer el pago.');
      if (input.installment !== undefined && input.installment !== purchase.paidInstallments) return; // Segundo toque.
      if (purchase.paidInstallments === 0) throw new AppError('Esta compra no tiene pagos para deshacer.');
      const number = purchase.paidInstallments;
      await this.legacyWrite(() => this.ctx.ledger.writeCardPayment(purchase, purchase.undoLastPayment(), [], [`cp-${purchase.id}-${number}`, `ci-${purchase.id}-${number}`]));
    });
  }

  /** Paga el capital restante más solo el interés de la próxima cuota, y cierra la compra. */
  settle(purchaseId: string, input: SettleInput): Promise<ActionResult> {
    return writeAction(this.ctx, async () => {
      const purchase = await this.requirePurchase(purchaseId);
      await this.assertLegacyAllowed(purchase.cardId);
      if (purchase.isClosed) throw new AppError('Esta compra ya está liquidada.');
      if (purchase.paidInstallments >= purchase.installments) throw new AppError('Esta compra ya está pagada.');
      const paidOn = parseCardDate(input.paidOn);
      await this.assertAccount(input.fromAccountId);
      const offer = settleOffer(purchase);
      const put = this.payments(purchase, input.fromAccountId, paidOn, {
        capitalId: `cp-${purchase.id}-liq`,
        capital: offer.capital,
        capitalDescription: fitDescription(`Liquidación ${purchase.description}`, ''),
        interestId: `ci-${purchase.id}-liq`,
        interest: offer.interest,
        interestDescription: fitDescription(`Intereses liquidación ${purchase.description}`, ''),
      });
      await this.legacyWrite(() => this.ctx.ledger.writeCardPayment(purchase, purchase.close(paidOn), put));
    });
  }

  /** Paga la cuota de manejo de un mes, en orden, y marca el mes como pagado en una sola escritura. */
  payFee(cardId: string, month: string, input: PayFeeInput): Promise<ActionResult> {
    return writeAction(this.ctx, async () => {
      const card = await this.requireCard(cardId);
      await this.assertLegacyAllowed(card.id);
      const notPending = new AppError('Esa cuota de manejo no está pendiente.');
      if (!isMonthKey(month) || card.fee.kind === 'NONE') throw notPending;
      if (card.feesSettledThrough !== undefined && month <= card.feesSettledThrough) return; // Segundo toque.
      const purchases = await this.ctx.purchases.findByCard(card.id);
      const pending = cardFeesDue(card, purchases, BEGINNING, feeHorizon(`${month}-01`));
      if (!pending.some((f) => f.month === month)) throw notPending;
      if (pending[0]!.month !== month) throw new AppError(`Paga primero la cuota de manejo de ${monthName(pending[0]!.month)}.`);

      const amount = input.amount === undefined ? pending[0]!.amount : parseMoney(input.amount);
      if (!amount.isPositive()) throw new AppError('El valor del manejo debe ser mayor que cero.');
      const paidOn = parseCardDate(input.paidOn);
      await this.assertAccount(input.fromAccountId);
      const payment = TransactionFactory.create({
        id: `cf-${card.id}-${month}`,
        type: 'EXPENSE',
        accountId: input.fromAccountId,
        amount,
        date: paidOn,
        description: fitDescription(`Manejo ${card.name}`, ` (${formatMonthLong(month)})`),
        category: INTEREST_CATEGORY,
      });
      await this.legacyWrite(() => this.ctx.ledger.writeFeePayment(card, CreditCard.create({ ...card.toProps(), feesSettledThrough: month }), payment));
    });
  }

  /**
   * Deshace el último pago de manejo que realmente se hizo. El marcador solo dice "hasta qué mes va lo
   * saldado", así que se deja en el mes justo anterior al deshecho: todo lo de antes sigue saldado y solo
   * esa cuota vuelve a quedar pendiente, aunque el mes anterior no haya tenido cobro.
   */
  undoLastFee(cardId: string, input: { month?: string } = {}): Promise<ActionResult> {
    return writeAction(this.ctx, async () => {
      const card = await this.requireCard(cardId);
      await this.assertLegacyAllowed(card.id);
      const latest = latestFeeMonths(await this.ctx.ledger.feePaymentIds()).get(card.id);
      if (input.month !== undefined && input.month !== latest) return; // Segundo toque.
      if (latest === undefined) throw new AppError('Esta tarjeta no tiene pagos de manejo para deshacer.');
      const previous = previousMonth(latest);
      const feesSettledThrough = previous >= card.feeStartMonth ? previous : undefined;
      await this.legacyWrite(() => this.ctx.ledger.writeFeeUndo(card, CreditCard.create({ ...card.toProps(), feesSettledThrough }), `cf-${card.id}-${latest}`));
    });
  }

  /** Desglose de un pago único a la tarjeta, al día del pago (calendario de Colombia). No escribe nada. */
  async previewCardPayment(cardId: string, input: CardPaymentPreviewInput): Promise<CardPaymentPreviewResult> {
    try {
      const card = await this.requireCard(cardId);
      const [purchases, payments] = await this.cardState(card.id);
      const { amount, paidOn, preview } = this.planPayment(card, purchases, payments, input);
      const names = new Map(purchases.map((p) => [p.id, p.description]));
      const due = cardDue(card, purchases, payments, paidOn);
      const overdue = due.filter((i) => i.overdue).reduce((sum, i) => sum + i.amount.amount, 0n);
      const pendingCapital = new Map(purchaseBalances(card, purchases, payments, paidOn).map((b) => [b.purchase.id, b.pendingCapital.amount]));
      const firstExtra = preview.allocations.find((a) => a.kind === 'EXTRA');
      // Mismo orden que sugiere el dominio para la plata de más: mayor tasa, luego la compra más antigua.
      const targets = purchaseBalances(card, purchases, payments, paidOn)
        .filter((b) => b.extraCapacity.isPositive())
        .map((b) => b.purchase)
        .sort((a, b) => b.monthlyRatePpm - a.monthlyRatePpm || a.purchaseDate.getTime() - b.purchaseDate.getTime() || a.id.localeCompare(b.id));
      const outcomeView = (o: PaymentPreview['outcomes'][number]['SHORTEN']) => ({
        remainingInstallments: o.remainingInstallments,
        nextInstallment: o.nextInstallment.amount.toString(),
        endDate: o.lastDueDate && isoDay(o.lastDueDate),
      });
      const view: CardPaymentPreview = {
        total: amount.amount.toString(),
        max: maxPayment(card, purchases, payments, paidOn, CURRENCY).amount.toString(),
        fees: preview.fees.map((f) => ({ month: f.month, amount: f.amount.amount.toString() })),
        purchases: preview.purchases.map((p) => ({
          purchaseId: p.purchaseId,
          description: names.get(p.purchaseId) ?? '',
          interest: p.interest.amount.toString(),
          capital: p.capital.amount.toString(),
          extraCapital: p.extraCapital.amount.toString(),
          // Todo su capital pendiente queda cubierto: lo debido va antes que el capital, así que no queda nada.
          paidOff: p.capital.amount + p.extraCapital.amount === pendingCapital.get(p.purchaseId),
        })),
        extraCapital: preview.extraCapital.amount.toString(),
        needsMode: preview.extraCapital.isPositive(),
        outcomes: preview.outcomes.map((o) => ({ purchaseId: o.purchaseId, SHORTEN: outcomeView(o.SHORTEN), LOWER: outcomeView(o.LOWER) })),
        // Lo vencido se reparte antes que todo lo demás: lo que el pago no alcanza a cubrir sigue vencido.
        pending: (overdue > amount.amount ? overdue - amount.amount : 0n).toString(),
        dueSoon: dueSoonAfter(due, amount.amount > overdue ? amount.amount - overdue : 0n),
        extraPurchaseId: firstExtra?.kind === 'EXTRA' ? firstExtra.purchaseId : null,
        extraTargets: firstExtra ? targets.map((p) => ({ purchaseId: p.id, description: p.description })) : [],
        signature: signatureOf(amount, paidOn, preview.allocations),
      };
      return { ok: true, preview: view };
    } catch (e) {
      return { ok: false, error: toMessage(e) };
    }
  }

  /**
   * Pago único a la tarjeta: reparte el valor (lo vencido, lo del periodo y la plata de más) y guarda el pago
   * con sus movimientos en una sola escritura. Repetir el mismo `paymentId` no registra nada más.
   */
  payCard(cardId: string, input: CardPaymentInput): Promise<ActionResult> {
    return writeAction(this.ctx, async () => {
      const card = await this.requireCard(cardId);
      if (typeof input.paymentId !== 'string' || !PAYMENT_ID.test(input.paymentId)) throw new AppError(BAD_PAYMENT_ID);
      const existing = await this.ctx.cardPayments.findById(input.paymentId);
      if (existing) {
        // Segundo toque: si es el mismo pago no se hace nada; si trae otros valores, se avisa.
        const same =
          existing.cardId === card.id &&
          existing.total.amount.toString() === String(input.amount).trim() &&
          isoDay(existing.paidOn) === input.paidOn &&
          (input.expected === undefined || input.expected === signatureOf(existing.total, existing.paidOn, existing.allocations));
        if (!same) throw new AppError(OTHER_VALUES);
        return;
      }
      if ((await this.ctx.cardPayments.count()) >= MAX_CARD_PAYMENTS) {
        throw new AppError(`Llegaste al máximo de ${MAX_CARD_PAYMENTS.toLocaleString('es-CO')} pagos de tarjeta.`);
      }
      const [purchases, payments] = await this.cardState(card.id);
      const { amount, paidOn, preview } = this.planPayment(card, purchases, payments, input);
      // Lo que se guarda tiene que ser exactamente el desglose que se mostró.
      if (input.expected !== undefined && input.expected !== signatureOf(amount, paidOn, preview.allocations)) throw new AppError(CARD_CHANGED);
      await this.assertAccount(input.fromAccountId);
      const movements = this.cardPaymentMovements(card, purchases, preview, input.paymentId, input.fromAccountId, paidOn);
      const lastSeq = lastSeqOf(payments);
      const payment = createCardPayment({
        id: input.paymentId,
        cardId: card.id,
        seq: lastSeq + 1,
        paidOn,
        fromAccountId: input.fromAccountId,
        total: amount,
        extraMode: input.mode,
        allocations: preview.allocations,
        transactionIds: movements.map((t) => t.id),
      });
      if ((await this.ctx.ledger.writeCardPaymentEvent(lastSeq, payment, movements, purchases)) === 'changed') throw new AppError(CARD_CHANGED);
    });
  }

  /** Atajos del formulario al día del pago: «Lo de este mes» (lo vencido y lo del periodo) y «Todo» (el máximo). */
  async paymentShortcuts(cardId: string, paidOnText: string): Promise<CardPaymentShortcuts> {
    try {
      const card = await this.requireCard(cardId);
      const [purchases, payments] = await this.cardState(card.id);
      const paidOn = parseCardDate(paidOnText);
      validatePaymentDate(paidOn, payments, parseDay(todayISO(this.ctx.now())));
      const thisMonth = cardDue(card, purchases, payments, paidOn).reduce((sum, i) => sum + i.amount.amount, 0n);
      return { ok: true, thisMonth: thisMonth.toString(), max: maxPayment(card, purchases, payments, paidOn, CURRENCY).amount.toString() };
    } catch (e) {
      return { ok: false, error: toMessage(e) };
    }
  }

  /** Quita el último pago único de la tarjeta y sus movimientos, en una sola escritura. */
  undoLastCardPayment(cardId: string, input: { paymentId?: string } = {}): Promise<ActionResult> {
    return writeAction(this.ctx, async () => {
      const card = await this.requireCard(cardId);
      const payments = await this.ctx.cardPayments.findByCard(card.id);
      const last = payments[payments.length - 1];
      if (input.paymentId !== undefined && input.paymentId !== last?.id) return; // Segundo toque.
      if (!last) throw new AppError(NOTHING_TO_UNDO);
      if (!(await this.ctx.ledger.removeCardPaymentEvent(last))) throw new AppError(CARD_CHANGED);
    });
  }

  private cardState(cardId: string): Promise<[CardPurchase[], CardPayment[]]> {
    return Promise.all([this.ctx.purchases.findByCard(cardId), this.ctx.cardPayments.findByCard(cardId)]);
  }

  /** Valida monto y fecha (día calendario de Colombia) y reparte el pago al día en que se hizo. */
  private planPayment(card: CreditCard, purchases: readonly CardPurchase[], payments: readonly CardPayment[], input: CardPaymentPreviewInput) {
    const amount = parseMoney(input.amount);
    const paidOn = parseCardDate(input.paidOn);
    validatePaymentDate(paidOn, payments, parseDay(todayISO(this.ctx.now())));
    const preview = paymentPreview(card, purchases, payments, paidOn, amount, { extraPurchaseId: input.extraPurchaseId });
    return { amount, paidOn, preview };
  }

  /**
   * Movimientos de un pago único: por cada compra, el capital (con su categoría) y el interés; luego cada
   * cuota de manejo. Los de valor cero no se crean. Ids `pt-<pago>-<nn>` en ese orden.
   */
  private cardPaymentMovements(card: CreditCard, purchases: readonly CardPurchase[], preview: PaymentPreview, paymentId: string, accountId: string, date: Date): Transaction[] {
    const byId = new Map(purchases.map((p) => [p.id, p]));
    const parts: { amount: Money; description: string; category?: string }[] = [];
    for (const p of preview.purchases) {
      const purchase = byId.get(p.purchaseId)!;
      parts.push({ amount: p.capital.add(p.extraCapital), description: fitDescription(purchase.description, ' (pago de tarjeta)'), category: purchase.category });
      parts.push({ amount: p.interest, description: fitDescription(`Intereses ${purchase.description}`, ''), category: INTEREST_CATEGORY });
    }
    for (const fee of preview.fees) {
      parts.push({ amount: fee.amount, description: fitDescription(`Manejo ${card.name}`, ` (${formatMonthLong(fee.month)})`), category: INTEREST_CATEGORY });
    }
    return parts
      .filter((part) => part.amount.isPositive())
      .map((part, i) =>
        TransactionFactory.create({
          id: `pt-${paymentId}-${String(i + 1).padStart(2, '0')}`,
          type: 'EXPENSE',
          accountId,
          amount: part.amount,
          date,
          description: part.description,
          category: part.category,
        }),
      );
  }

  /** Los pagos y deshacer del sistema anterior solo valen mientras la tarjeta no tenga pagos únicos. */
  private async assertLegacyAllowed(cardId: string): Promise<void> {
    if ((await this.ctx.cardPayments.countByCard(cardId)) > 0) throw new AppError(LEGACY_LOCKED);
  }

  /** Escritura del sistema anterior: si al guardar resulta que la tarjeta ya tiene pagos únicos, se avisa. */
  private async legacyWrite(write: () => Promise<unknown>): Promise<void> {
    try {
      await write();
    } catch (e) {
      if (e instanceof LegacyLockedError) throw new AppError(LEGACY_LOCKED);
      throw e;
    }
  }

  private buildCard(id: string, input: CardInput, feeStartMonth: string, feesSettledThrough?: string): CreditCard {
    assertTextLength('name', input.name);
    return CreditCard.create({
      id,
      name: input.name,
      dueDay: input.dueDay,
      cutDay: input.cutDay,
      paymentAccountId: input.paymentAccountId,
      fee: feeOf(input),
      rate: rateOf(input),
      feeStartMonth,
      feesSettledThrough,
    });
  }

  private payments(
    purchase: CardPurchase,
    accountId: string,
    date: Date,
    p: { capitalId: string; capital: Money; capitalDescription: string; interestId: string; interest: Money; interestDescription: string },
  ): Transaction[] {
    const out: Transaction[] = [];
    if (p.capital.isPositive()) {
      out.push(TransactionFactory.create({ id: p.capitalId, type: 'EXPENSE', accountId, amount: p.capital, date, description: p.capitalDescription, category: purchase.category }));
    }
    if (p.interest.isPositive()) {
      out.push(TransactionFactory.create({ id: p.interestId, type: 'EXPENSE', accountId, amount: p.interest, date, description: p.interestDescription, category: INTEREST_CATEGORY }));
    }
    return out;
  }

  private parseInterest(raw: string): Money {
    const interest = parseMoney(raw);
    if (interest.isNegative()) throw new AppError('El interés no puede ser negativo.');
    return interest;
  }

  private assertLockedFieldsUnchanged(existing: CardPurchase, input: PurchaseInput): void {
    const sameAmount = parseMoney(input.amount).amount === existing.amount.amount;
    const sameDates = parseCardDate(input.purchaseDate).getTime() === existing.purchaseDate.getTime() && parseCardDate(input.firstDueDate).getTime() === existing.firstDueDate.getTime();
    const unchanged =
      input.cardId === existing.cardId &&
      sameAmount &&
      input.installments === existing.installments &&
      sameDates &&
      (input.paidInstallments === undefined || input.paidInstallments === existing.paidInstallments) &&
      (input.withoutInterest === undefined || input.withoutInterest === (existing.monthlyRatePpm === 0));
    if (!unchanged) throw new AppError(LOCKED_PURCHASE);
  }

  private termsOf(card: CreditCard): CardTerms {
    return { id: card.id, dueDay: card.dueDay, cutDay: card.cutDay ?? null, monthlyRatePpm: card.rate?.monthlyPpm ?? 0 };
  }

  private async requireCard(id: string): Promise<CreditCard> {
    const card = await this.ctx.cards.findById(id);
    if (!card) throw notFound('esa tarjeta');
    return card;
  }

  private async requirePurchase(id: string): Promise<CardPurchase> {
    const purchase = await this.ctx.purchases.findById(id);
    if (!purchase) throw notFound('esa compra');
    return purchase;
  }

  private async assertAccount(accountId: string): Promise<void> {
    if (!(await this.ctx.accounts.findById(accountId))) throw new UnknownAccountError(accountId);
  }
}
