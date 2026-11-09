import type { ActionResult } from './action-result';
import { formatDueDate, formatMoneyCompact, parseAmountInput } from './format';
import type {
  CardFeeKind,
  CardInput,
  CardView,
  FeeImpact,
  PayFeeInput,
  PayInstallmentInput,
  PurchaseInput,
  PurchasePreview,
  PurchasePreviewResult,
  PurchaseView,
  RateBasis,
  RateCheck,
  SettleInput,
} from './types';
import type { FieldErrors, ValidationResult } from './validation';

/** Lo que la pantalla de tarjetas necesita de la app: sus acciones y sus cálculos. */
export interface CardsApi {
  createCard(input: CardInput): Promise<ActionResult>;
  updateCard(id: string, input: CardInput): Promise<ActionResult>;
  removeCard(id: string): Promise<ActionResult>;
  addPurchase(input: PurchaseInput): Promise<ActionResult>;
  updatePurchase(id: string, input: PurchaseInput): Promise<ActionResult>;
  removePurchase(id: string): Promise<ActionResult>;
  payInstallment(id: string, input: PayInstallmentInput): Promise<ActionResult>;
  undoLastPayment(id: string, input?: { installment?: number }): Promise<ActionResult>;
  settle(id: string, input: SettleInput): Promise<ActionResult>;
  payFee(cardId: string, month: string, input: PayFeeInput): Promise<ActionResult>;
  undoLastFee(cardId: string, input?: { month?: string }): Promise<ActionResult>;
  cardChangeImpact(cardId: string, input: CardInput): Promise<FeeImpact>;
  purchaseRemovalImpact(purchaseId: string): Promise<FeeImpact>;
  purchaseChangeImpact(purchaseId: string, input: PurchaseInput): Promise<FeeImpact>;
  checkRate(text: string, basis: RateBasis): RateCheck;
  suggestFirstDueDate(card: Pick<CardView, 'dueDay'>, purchaseDate: string): string | null;
  /** Con `agreed`, calcula con lo que ya se pactó en esa compra y no con la tasa actual de la tarjeta. */
  previewPurchase(
    card: Pick<CardView, 'id' | 'dueDay' | 'monthlyRatePpm'>,
    input: PurchaseInput,
    agreed?: Pick<PurchaseView, 'monthlyRatePpm' | 'purchaseDate' | 'firstDueDate' | 'dueDayAnchor'>,
  ): PurchasePreviewResult;
}

const MAX_INSTALLMENTS = 72;
const RATE_ZERO = 'La tasa debe ser mayor que 0. Si no cobra intereses, elige "Sin intereses".';
const WHOLE = /^\d+$/;

function wholeIn(text: string, min: number, max: number): number | null {
  const trimmed = text.trim();
  if (!WHOLE.test(trimmed)) return null;
  const n = Number(trimmed);
  return n >= min && n <= max ? n : null;
}

export interface CardFormValues {
  name: string;
  dueDayText: string;
  paymentAccountId: string;
  feeKind: CardFeeKind;
  feeAmountText: string;
  hasInterest: boolean;
  rateBasis: RateBasis;
  rateText: string;
}

export function validateCardForm(v: CardFormValues, checkRate: CardsApi['checkRate']): ValidationResult<CardInput> {
  const errors: FieldErrors = {};
  if (!v.name.trim()) errors.name = 'Escribe el nombre de la tarjeta.';
  const dueDay = wholeIn(v.dueDayText, 1, 31);
  if (dueDay === null) errors.dueDay = 'El día de pago va de 1 a 31.';
  if (!v.paymentAccountId) errors.account = 'Elige la cuenta desde la que pagas.';
  const charges = v.feeKind !== 'NONE';
  const feeAmount = charges ? parseAmountInput(v.feeAmountText) : null;
  if (charges && !feeAmount) errors.feeAmount = 'Escribe cuánto cobra de manejo.';
  if (v.hasInterest) {
    if (/^[0.,\s]*$/.test(v.rateText)) errors.rate = RATE_ZERO;
    else {
      const { error } = checkRate(v.rateText, v.rateBasis);
      if (error) errors.rate = error;
    }
  }
  if (Object.keys(errors).length > 0 || dueDay === null) return { ok: false, errors };
  const value: CardInput = { name: v.name.trim(), dueDay, paymentAccountId: v.paymentAccountId, feeKind: v.feeKind };
  if (feeAmount) value.feeAmount = feeAmount;
  if (v.hasInterest) {
    value.rateBasis = v.rateBasis;
    value.rateText = v.rateText.trim();
  }
  return { ok: true, value };
}

export interface PurchaseFormValues {
  cardId: string;
  description: string;
  amountText: string;
  /** Un número de las opciones, o 'Otro'. */
  installmentsChoice: string;
  otherInstallmentsText: string;
  purchaseDate: string;
  firstDueDate: string;
  category: string;
  paidText: string;
  withoutInterest: boolean;
}

export function installmentsOf(choice: string, otherText: string): number | null {
  return choice === 'Otro' ? wholeIn(otherText, 1, MAX_INSTALLMENTS) : wholeIn(choice, 1, MAX_INSTALLMENTS);
}

export function validatePurchaseForm(v: PurchaseFormValues): ValidationResult<PurchaseInput> {
  const errors: FieldErrors = {};
  if (!v.cardId) errors.card = 'Elige la tarjeta.';
  if (!v.description.trim()) errors.description = 'Escribe qué compraste.';
  const amount = parseAmountInput(v.amountText);
  if (!amount) errors.amount = 'Escribe un monto mayor a cero.';
  const installments = installmentsOf(v.installmentsChoice, v.otherInstallmentsText);
  if (installments === null) errors.installments = 'El número de cuotas va de 1 a 72.';
  if (!v.purchaseDate) errors.purchaseDate = 'Elige la fecha de la compra.';
  if (!v.firstDueDate) errors.firstDueDate = 'Elige la fecha de la primera cuota.';
  else if (v.purchaseDate && v.firstDueDate < v.purchaseDate) errors.firstDueDate = 'La primera cuota no puede ser antes de la compra.';
  const paid = v.paidText.trim() === '' ? 0 : wholeIn(v.paidText, 0, MAX_INSTALLMENTS);
  if (paid === null || (installments !== null && paid > installments)) errors.paid = 'Las cuotas ya pagadas no pueden ser más que el total de cuotas.';
  if (Object.keys(errors).length > 0 || !amount || installments === null) return { ok: false, errors };
  const value: PurchaseInput = { cardId: v.cardId, description: v.description.trim(), amount, installments, purchaseDate: v.purchaseDate, firstDueDate: v.firstDueDate };
  const category = v.category.trim();
  if (category) value.category = category;
  if (paid) value.paidInstallments = paid;
  if (v.withoutInterest) value.withoutInterest = true;
  return { ok: true, value };
}

/** El aviso antes de confirmar un cambio que afecta cuotas de manejo sin pagar; null si no afecta ninguna. */
export function feeImpactText(impact: FeeImpact): string | null {
  const count = (n: number) => `${n} ${n === 1 ? 'cuota' : 'cuotas'} de manejo`;
  const parts: string[] = [];
  if (impact.lostCount > 0) parts.push(`Dejarás de ver ${count(impact.lostCount)} por ${formatMoneyCompact(impact.lostAmount)}.`);
  if (impact.changedCount > 0) parts.push(`Cambiará el valor de ${count(impact.changedCount)} sin pagar.`);
  return parts.length > 0 ? parts.join(' ') : null;
}

const money = formatMoneyCompact;
const at = (i: { total: string; dueDate: string }, today: string) => `${money(i.total)} el ${formatDueDate(i.dueDate, today)}`;

/** El párrafo de la confirmación. Si ya hay cuotas pagadas habla solo de lo que falta. */
export function purchaseSummary(p: PurchasePreview, today: string): string {
  if (p.remainingCount === 0) return `Ya tienes pagadas las ${p.totalCount} cuotas. No queda nada por pagar.`;
  const first = p.installments[0]!;
  const last = p.installments[p.installments.length - 1]!;
  if (p.remainingCount < p.totalCount) {
    const totals = `Intereses por pagar: ${money(p.totalInterest)}. Total por pagar: ${money(p.totalToPay)}.`;
    if (p.remainingCount === 1) return `Te falta 1 de ${p.totalCount} cuotas: ${at(first, today)}. ${totals}`;
    return `Te faltan ${p.remainingCount} de ${p.totalCount} cuotas. La próxima: ${at(first, today)}. La última: ${at(last, today)}. ${totals}`;
  }
  const totals = `Intereses en total: ${money(p.totalInterest)}. Total a pagar: ${money(p.totalToPay)}.`;
  if (p.totalCount === 1) return `Vas a pagar 1 cuota: ${at(first, today)}. ${totals}`;
  return `Vas a pagar ${p.totalCount} cuotas. La primera: ${at(first, today)}. La última: ${at(last, today)}. ${totals}`;
}
