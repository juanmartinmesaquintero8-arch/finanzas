/** Contrato de la API (ver apps/api/src/application/views.ts). Sin lógica de negocio. */
export interface MoneyView {
  amount: string;
  currency: string;
}

export type AccountType = 'CASH' | 'BANK' | 'DIGITAL' | 'SAVINGS' | 'CREDIT';
export type TransactionType = 'INCOME' | 'EXPENSE' | 'TRANSFER';
export type Frequency = 'ONCE' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  initialBalance: MoneyView;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: MoneyView;
  date: string;
  description: string;
  category: string | null;
  accountId: string | null;
  fromAccountId: string | null;
  toAccountId: string | null;
  /** Solo en la app móvil: el movimiento es un pago de tarjeta y no se edita como los demás. */
  cardPayment?: CardPaymentInfo;
}

export interface CardPaymentInfo {
  /** Por qué no se puede editar o borrar desde el historial. */
  message: string;
  /** true solo si su compra o tarjeta ya no existe: no queda deuda que cuadrar. */
  canDelete: boolean;
}

export interface TransactionPage {
  items: Transaction[];
  nextCursor: string | null;
}

export interface ScheduledExpense {
  id: string;
  description: string;
  amount: MoneyView;
  accountId: string;
  frequency: Frequency;
  startDate: string;
  endDate: string | null;
  settledThrough: string | null;
  /** Solo la app móvil la usa; la API aún no la envía. */
  category?: string | null;
}

/** Un ingreso programado se ve igual que un gasto programado. */
export type ScheduledIncome = ScheduledExpense;

export interface Summary {
  netWorth: MoneyView;
  accounts: { accountId: string; name: string; type: AccountType; balance: MoneyView }[];
}

export interface Projection {
  from: string;
  to: string;
  netWorth: MoneyView;
  committed: MoneyView;
  availableBalance: MoneyView;
  isShortfall: boolean;
  commitments: { scheduledExpenseId: string; description: string; accountId: string; date: string; amount: MoneyView }[];
  accounts: { accountId: string; name: string; balance: MoneyView; committed: MoneyView; available: MoneyView }[];
  timeline: { date: string; balance: MoneyView }[];
  /** Solo la app móvil los calcula (ingresos programados); la API no los envía. */
  expectedIncome?: MoneyView;
  availableWithIncome?: MoneyView;
  lowestWithIncome?: { date: string; balance: MoneyView };
  /** Fecha ('YYYY-MM-DD') del último ingreso esperado en la ventana; ausente si no hay. */
  lastExpectedIncomeDate?: string;
}

/** Proyección con los datos de ingresos esperados ya presentes. */
export type ProjectionWithIncome = Projection &
  Required<Pick<Projection, 'expectedIncome' | 'availableWithIncome' | 'lowestWithIncome'>>;

export interface CreateAccountInput {
  name: string;
  type: AccountType;
  initialBalance: string;
}

/** PATCH /accounts/:id: la web siempre envía los tres campos. */
export type UpdateAccountInput = CreateAccountInput;

export interface CreateTransactionInput {
  type: TransactionType;
  amount: string;
  date: string;
  description: string;
  category?: string;
  accountId?: string;
  fromAccountId?: string;
  toAccountId?: string;
}

export interface CreateScheduledExpenseInput {
  description: string;
  amount: string;
  accountId: string;
  frequency: Frequency;
  startDate: string;
  endDate?: string;
  category?: string;
}

export type CreateScheduledIncomeInput = CreateScheduledExpenseInput;

/** Una fila de "En qué gasto": montos como texto de entero (bigint), porcentajes solo para mostrar. */
export interface SpendingRowView {
  key: string;
  label: string;
  kind: 'category' | 'uncategorized' | 'other';
  amount: string;
  percent: number;
  /** Largo de la barra, 0 a 100, relativo a la mayor fila. */
  barPct: number;
  /** Posición de la marca del mes anterior sobre la misma escala; null si no hay. */
  previousMarkPct: number | null;
  /** Gasto de esta fila menos el del mes de comparación (puede ser negativo); null sin comparación. */
  delta: string | null;
  isNew: boolean;
}

export interface SpendingView {
  /** 'YYYY-MM' */
  month: string;
  previousMonth: string;
  isCurrent: boolean;
  /** En el mes en curso: hasta qué día del mes se comparó; null en un mes cerrado. */
  comparedUntilDay: number | null;
  /** Primer y último mes a los que se puede navegar. */
  oldestMonth: string;
  currentMonth: string;
  total: string;
  /** Total del mes de comparación; null si ese mes no tuvo gastos. */
  previousTotal: string | null;
  /** total - previousTotal (puede ser negativo); null si el mes anterior no tuvo gastos. */
  totalDelta: string | null;
  rows: SpendingRowView[];
}

export type CardFeeKind = 'NONE' | 'FIXED_MONTHLY' | 'ON_MOVEMENT';
export type RateBasis = 'MV' | 'EA';

/** Una cuota: montos como texto de entero (bigint). */
export interface InstallmentView {
  number: number;
  /** 'YYYY-MM-DD' */
  dueDate: string;
  capital: string;
  interest: string;
  total: string;
}

export interface PurchaseView {
  id: string;
  cardId: string;
  description: string;
  category: string | null;
  amount: string;
  installments: number;
  paidInstallments: number;
  purchaseDate: string;
  firstDueDate: string;
  monthlyRatePpm: number;
  closedOn: string | null;
  dueDayAnchor: number | null;
  /** La cuota por pagar; null si está liquidada o pagada por completo. */
  next: InstallmentView | null;
  /** Cuotas ya pagadas por completo y cuotas que tiene hoy (terminar antes las reduce). */
  paidCount: number;
  installmentCount: number;
  /** Lo que costaría liquidarla hoy; null si ya no se debe nada. */
  settle: { capital: string; interest: string; total: string } | null;
}

export interface PendingFeeView {
  /** 'YYYY-MM' */
  month: string;
  dueDate: string;
  amount: string;
}

export interface CardView {
  id: string;
  name: string;
  dueDay: number;
  /** Día en que el banco cierra el extracto; null si aún no se ha dicho. */
  cutDay: number | null;
  paymentAccountId: string;
  feeKind: CardFeeKind;
  feeAmount: string | null;
  rateBasis: RateBasis | null;
  /** La tasa como se escribe: '1,87'. */
  rateText: string | null;
  /** Tasa mensual en ppm con la que se calculan las compras nuevas (0 sin intereses). */
  monthlyRatePpm: number;
  chargesInterest: boolean;
  /** Capital pendiente de todas sus compras. */
  debt: string;
  next: { amount: string; date: string } | null;
  purchases: PurchaseView[];
  pendingFees: PendingFeeView[];
  /** Último mes de manejo con pago real ('YYYY-MM'); null si no hay ninguno. */
  lastPaidFeeMonth: string | null;
  /** Lo vencido hoy (cuotas y manejo sin pagar con fecha anterior a hoy). */
  overdue: string;
  /** Último pago único a la tarjeta; null si aún no tiene ninguno (siguen los botones del sistema anterior). */
  lastCardPayment: { id: string; total: string; paidOn: string } | null;
}

/** Qué cuotas de manejo sin pagar desaparecen o cambian si se hace un cambio. */
export interface FeeImpact {
  lostCount: number;
  lostAmount: string;
  changedCount: number;
  /** Cuotas que cambian de fecha sin cambiar de valor (solo al cambiar el corte). */
  movedCount?: number;
  /** Cuotas que antes no se veían y aparecerían (solo al cambiar el corte). */
  newCount?: number;
  newAmount?: string;
}

export interface CardInput {
  name: string;
  dueDay: number;
  cutDay?: number;
  paymentAccountId: string;
  feeKind: CardFeeKind;
  feeAmount?: string;
  /** Ambos o ninguno: sin ellos la tarjeta no cobra intereses. */
  rateBasis?: RateBasis;
  rateText?: string;
}

export interface PurchaseInput {
  cardId: string;
  description: string;
  amount: string;
  installments: number;
  purchaseDate: string;
  firstDueDate: string;
  category?: string;
  paidInstallments?: number;
  withoutInterest?: boolean;
}

export interface PayInstallmentInput {
  fromAccountId: string;
  paidOn: string;
  /** Interés de esta cuota si el extracto dice otro valor (≥ 0, sin decimales). */
  interest?: string;
  /** Número de la cuota que se ve en pantalla: evita que un segundo toque pague la siguiente. */
  installment?: number;
}

export interface SettleInput {
  fromAccountId: string;
  paidOn: string;
}

export interface PayFeeInput {
  fromAccountId: string;
  paidOn: string;
  amount?: string;
}

/** Qué hacer con la plata de más: terminar antes (misma cuota) o bajar la cuota (mismas cuotas). */
export type ExtraMode = 'SHORTEN' | 'LOWER';

/** Datos de un pago único a la tarjeta, para el desglose. Montos en pesos enteros como texto. */
export interface CardPaymentPreviewInput {
  amount: string;
  paidOn: string;
  fromAccountId: string;
  mode?: ExtraMode;
  /** Compra que recibe primero la plata de más; si no se da, la de mayor tasa. */
  extraPurchaseId?: string;
}

/** Pago único a la tarjeta. `paymentId` se crea al abrir el formulario: repetirlo no registra el pago dos veces. */
export interface CardPaymentInput extends CardPaymentPreviewInput {
  paymentId: string;
  /** Firma del desglose que se mostró: si el reparto ya no es el mismo, no se guarda nada. */
  expected?: string;
}

/** Cómo quedaría una compra con la plata de más. */
export interface CardPaymentOutcomeView {
  remainingInstallments: number;
  nextInstallment: string;
  /** Vencimiento de la última cuota que quedaría ('YYYY-MM-DD'); null si no queda ninguna. */
  endDate: string | null;
}

/** Desglose de un pago único antes de confirmarlo. */
export interface CardPaymentPreview {
  total: string;
  /** Lo más que se puede pagar ese día. */
  max: string;
  fees: { month: string; amount: string }[];
  purchases: { purchaseId: string; description: string; interest: string; capital: string; extraCapital: string }[];
  extraCapital: string;
  /** Hay plata de más: hay que elegir terminar antes o bajar la cuota. */
  needsMode: boolean;
  outcomes: { purchaseId: string; SHORTEN: CardPaymentOutcomeView; LOWER: CardPaymentOutcomeView }[];
  /** Lo vencido que queda sin pagar después de este pago. */
  pending: string;
  /** Compra que recibe primero la plata de más; null si no hay plata de más. */
  extraPurchaseId: string | null;
  /** Compras que pueden recibir plata de más, en el orden sugerido (primero la de mayor interés). */
  extraTargets: { purchaseId: string; description: string }[];
  /** Firma del reparto, para confirmar exactamente este desglose. */
  signature: string;
}

export type CardPaymentShortcuts = { ok: true; thisMonth: string; max: string } | { ok: false; error: string };

export type CardPaymentPreviewResult = { ok: true; preview: CardPaymentPreview } | { ok: false; error: string };

/** Lo que se confirma antes de guardar una compra. */
export interface PurchasePreview {
  totalCount: number;
  /** Cuotas que faltan por pagar (todas, si no hay cuotas ya pagadas). */
  remainingCount: number;
  /** Solo las cuotas que faltan. */
  installments: InstallmentView[];
  totalInterest: string;
  totalToPay: string;
}

export type PurchasePreviewResult = { ok: true; preview: PurchasePreview } | { ok: false; error: string };

/** Revisión de la tasa escrita: error que bloquea, o advertencia que no bloquea. */
export interface RateCheck {
  error?: string;
  warning?: boolean;
}
