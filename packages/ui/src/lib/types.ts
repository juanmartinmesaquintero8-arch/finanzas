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
}

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
}

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
}
