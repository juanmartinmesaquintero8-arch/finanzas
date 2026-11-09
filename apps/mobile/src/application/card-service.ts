import {
  CardPurchase,
  CreditCard,
  InterestRate,
  Money,
  TransactionFactory,
  UnknownAccountError,
  buildInstallmentPlan,
  cardDebt,
  cardFeesDue,
  defaultFirstDueDate,
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
  monthName,
  todayISO,
  type ActionResult,
  type CardInput,
  type CardView,
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
import { INT64_MAX, MAX_CARD_PURCHASES, MAX_CREDIT_CARDS, MAX_TEXT } from './limits';
import { AppError, CURRENCY, assertTextLength, isoDay, notFound, parseDay, parseMoney, toMessage, writeAction, type ServiceContext } from './support';

/** Categoría de los gastos que no son capital: intereses y cuotas de manejo. */
const INTEREST_CATEGORY = 'Intereses y manejo';
const TOO_BIG = 'El monto es demasiado grande.';
const BEGINNING = new Date(Date.UTC(2000, 0, 1));

/** Lo que una compra toma de su tarjeta. */
type CardTerms = Pick<CardView, 'id' | 'dueDay' | 'monthlyRatePpm'>;

/** Con el año entre 2000 y 2100 la fecha se guarda y se recupera siempre igual. */
function parseCardDate(raw: string): Date {
  const date = parseDay(raw);
  const year = date.getUTCFullYear();
  if (year < 2000 || year > 2100) throw new AppError('La fecha debe estar entre el año 2000 y el 2100.');
  return date;
}

/** Arma la compra validando textos, fechas y que todas sus cifras quepan en lo que se guarda. */
function buildPurchase(id: string, input: PurchaseInput, card: CardTerms, existing?: CardPurchase): CardPurchase {
  assertTextLength('description', input.description);
  assertTextLength('category', input.category);
  const purchaseDate = parseCardDate(input.purchaseDate);
  const firstDueDate = parseCardDate(input.firstDueDate);
  const sameDates = existing && existing.purchaseDate.getTime() === purchaseDate.getTime() && existing.firstDueDate.getTime() === firstDueDate.getTime();
  const isSuggested = defaultFirstDueDate(purchaseDate, card.dueDay).getTime() === firstDueDate.getTime();
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
    dueDayAnchor: sameDates ? existing.dueDayAnchor : isSuggested ? card.dueDay : undefined,
  });
  if (planSummary(buildInstallmentPlan(purchase)).totalToPay.amount > INT64_MAX) throw new AppError(TOO_BIG);
  return purchase;
}

function toInstallmentView(i: Installment): InstallmentView {
  return { number: i.number, dueDate: isoDay(i.dueDate), capital: i.capital.amount.toString(), interest: i.interest.amount.toString(), total: i.total.amount.toString() };
}

/** Vista previa de lo que se va a confirmar. Pura: no lee ni escribe nada. */
export function previewPurchase(card: CardTerms, input: PurchaseInput): PurchasePreviewResult {
  try {
    const purchase = buildPurchase('vista-previa', input, card);
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

function toPurchaseView(p: CardPurchase): PurchaseView {
  const next = isOpen(p) ? buildInstallmentPlan(p)[p.paidInstallments]! : null;
  const offer = isOpen(p) ? settleOffer(p) : null;
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
    next: next && toInstallmentView(next),
    settle: offer && { capital: offer.capital.amount.toString(), interest: offer.interest.amount.toString(), total: offer.total.amount.toString() },
  };
}

/** La próxima fecha con algo por pagar y la suma de las cuotas que caen ese día. */
function nextDue(purchases: readonly PurchaseView[]): CardView['next'] {
  const pending = purchases.flatMap((p) => (p.next && BigInt(p.next.total) > 0n ? [p.next] : []));
  if (pending.length === 0) return null;
  const date = pending.reduce((min, i) => (i.dueDate < min ? i.dueDate : min), pending[0]!.dueDate);
  const amount = pending.filter((i) => i.dueDate === date).reduce((sum, i) => sum + BigInt(i.total), 0n);
  return { amount: amount.toString(), date };
}

/** Fin del mes siguiente: hasta ahí se listan las cuotas de manejo pendientes. */
function feeHorizon(today: string): Date {
  return parseDay(endOfMonthISO(addMonthsISO(today, 1)));
}

export class CardService {
  constructor(private readonly ctx: ServiceContext) {}

  async list(): Promise<CardView[]> {
    const [cards, purchases] = await Promise.all([this.ctx.cards.findAll(), this.ctx.purchases.findAll()]);
    const horizon = feeHorizon(todayISO(this.ctx.now()));
    return [...cards].sort(byName).map((card) => this.toCardView(card, purchases, horizon));
  }

  private toCardView(card: CreditCard, purchases: readonly CardPurchase[], horizon: Date): CardView {
    const own = purchases.filter((p) => p.cardId === card.id);
    const views = own.map(toPurchaseView).sort(byPendingFirst);
    return {
      id: card.id,
      name: card.name,
      dueDay: card.dueDay,
      paymentAccountId: card.paymentAccountId,
      feeKind: card.fee.kind,
      feeAmount: card.fee.kind === 'NONE' ? null : card.fee.amount.amount.toString(),
      rateBasis: card.rate?.basis ?? null,
      rateText: card.rate ? formatRate(card.rate.ppm) : null,
      monthlyRatePpm: card.rate?.monthlyPpm ?? 0,
      chargesInterest: !!card.rate,
      debt: cardDebt(own, CURRENCY).amount.toString(),
      next: nextDue(views),
      purchases: views,
      pendingFees: cardFeesDue(card, purchases, BEGINNING, horizon).map((f) => ({ month: f.month, dueDate: isoDay(f.dueDate), amount: f.amount.amount.toString() })),
    };
  }

  /** Para Inicio: capital pendiente en todas las tarjetas. Es informativo: no se resta del Saldo Real. */
  async debtSummary(): Promise<{ hasCards: boolean; debt: string }> {
    const [cards, purchases] = await Promise.all([this.ctx.cards.findAll(), this.ctx.purchases.findAll()]);
    return { hasCards: cards.length > 0, debt: cardDebt(purchases, CURRENCY).amount.toString() };
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

  suggestFirstDueDate(card: Pick<CardView, 'dueDay'>, purchaseDate: string): string | null {
    if (!purchaseDate) return null;
    try {
      return isoDay(defaultFirstDueDate(parseDay(purchaseDate), card.dueDay));
    } catch {
      return null;
    }
  }

  previewPurchase(card: CardTerms, input: PurchaseInput): PurchasePreviewResult {
    return previewPurchase(card, input);
  }

  createCard(input: CardInput): Promise<ActionResult> {
    return writeAction(this.ctx, async () => {
      if ((await this.ctx.cards.findAll()).length >= MAX_CREDIT_CARDS) throw new AppError(`Llegaste al máximo de ${MAX_CREDIT_CARDS} tarjetas.`);
      const card = this.buildCard(this.ctx.newId(), input, todayISO(this.ctx.now()).slice(0, 7));
      await this.assertAccount(input.paymentAccountId);
      await this.ctx.cards.save(card);
    });
  }

  /** Conserva lo ya pagado; la tasa nueva solo aplica a las compras que vengan después. */
  updateCard(id: string, input: CardInput): Promise<ActionResult> {
    return writeAction(this.ctx, async () => {
      const existing = await this.requireCard(id);
      const feeStart = nextFeeStart(existing, feeOf(input), todayISO(this.ctx.now()).slice(0, 7));
      const card = this.buildCard(id, input, feeStart, existing.feesSettledThrough);
      await this.assertAccount(input.paymentAccountId);
      await this.ctx.cards.save(card);
    });
  }

  /** Borra la tarjeta y sus compras; los pagos reales quedan en el historial. */
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
      await this.ctx.purchases.save(buildPurchase(this.ctx.newId(), input, await this.cardTerms(input.cardId)));
    });
  }

  /** Con cuotas pagadas o la compra cerrada, solo cambian la descripción y la categoría. */
  updatePurchase(id: string, input: PurchaseInput): Promise<ActionResult> {
    return writeAction(this.ctx, async () => {
      const existing = await this.requirePurchase(id);
      if (existing.paidInstallments > 0 || existing.isClosed) {
        this.assertLockedFieldsUnchanged(existing, input);
        assertTextLength('description', input.description);
        assertTextLength('category', input.category);
        await this.ctx.purchases.save(CardPurchase.create({ ...existing.toProps(), description: input.description, category: input.category }));
        return;
      }
      await this.ctx.purchases.save(buildPurchase(id, input, await this.cardTerms(input.cardId), existing));
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
      await this.ctx.ledger.writeCardPayment(purchase, purchase.markPaid(number), put);
    });
  }

  /** Deshace la última cuota pagada: borra sus movimientos y resta una, en una sola escritura. */
  undoLastPayment(purchaseId: string, input: { installment?: number } = {}): Promise<ActionResult> {
    return writeAction(this.ctx, async () => {
      const purchase = await this.requirePurchase(purchaseId);
      if (purchase.isClosed) throw new AppError('Esta compra ya está liquidada, así que no se puede deshacer el pago.');
      if (input.installment !== undefined && input.installment !== purchase.paidInstallments) return; // Segundo toque.
      if (purchase.paidInstallments === 0) throw new AppError('Esta compra no tiene pagos para deshacer.');
      const number = purchase.paidInstallments;
      await this.ctx.ledger.writeCardPayment(purchase, purchase.undoLastPayment(), [], [`cp-${purchase.id}-${number}`, `ci-${purchase.id}-${number}`]);
    });
  }

  /** Paga el capital restante más solo el interés de la próxima cuota, y cierra la compra. */
  settle(purchaseId: string, input: SettleInput): Promise<ActionResult> {
    return writeAction(this.ctx, async () => {
      const purchase = await this.requirePurchase(purchaseId);
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
      await this.ctx.ledger.writeCardPayment(purchase, purchase.close(paidOn), put);
    });
  }

  /** Paga la cuota de manejo de un mes, en orden, y marca el mes como pagado en una sola escritura. */
  payFee(cardId: string, month: string, input: PayFeeInput): Promise<ActionResult> {
    return writeAction(this.ctx, async () => {
      const card = await this.requireCard(cardId);
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
        description: fitDescription(`Manejo ${card.name}`, ` (${month})`),
        category: INTEREST_CATEGORY,
      });
      await this.ctx.ledger.writeFeePayment(card, CreditCard.create({ ...card.toProps(), feesSettledThrough: month }), payment);
    });
  }

  private buildCard(id: string, input: CardInput, feeStartMonth: string, feesSettledThrough?: string): CreditCard {
    assertTextLength('name', input.name);
    return CreditCard.create({
      id,
      name: input.name,
      dueDay: input.dueDay,
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
    if (!unchanged) throw new AppError('Esta compra ya tiene cuotas pagadas: solo puedes cambiar la descripción y la categoría.');
  }

  private async cardTerms(cardId: string): Promise<CardTerms> {
    const card = await this.requireCard(cardId);
    return { id: card.id, dueDay: card.dueDay, monthlyRatePpm: card.rate?.monthlyPpm ?? 0 };
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
