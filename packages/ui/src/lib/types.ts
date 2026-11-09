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
