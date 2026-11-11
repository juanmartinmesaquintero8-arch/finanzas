import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export const DB_NAME = 'mis-finanzas';
/** La versión nunca debe bajar: un navegador con la base en v2 se negaría a abrir una v1. */
export const DB_VERSION = 3;

/** Filas tal como se guardan en IndexedDB: los montos son string de bigint, las fechas ISO. */
export interface StoredAccount {
  id: string;
  name: string;
  type: string;
  initialBalance: string;
  currency: string;
}

export interface StoredTransaction {
  id: string;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  amount: string;
  currency: string;
  /** ISO 8601 completo (UTC). Al ser de ancho fijo, el orden de texto es el orden cronológico. */
  date: string;
  description: string;
  category: string | null;
  accountId: string | null;
  fromAccountId: string | null;
  toAccountId: string | null;
  /** Una clave `cuenta|fecha` por cuenta involucrada: sirve al índice del historial filtrado. */
  accountDates: string[];
}

export interface StoredScheduledExpense {
  id: string;
  description: string;
  amount: string;
  currency: string;
  accountId: string;
  frequency: string;
  startDate: string;
  endDate: string | null;
  settledThrough: string | null;
  /** Ausente en las filas guardadas antes de existir la categoría. */
  category?: string | null;
}

/** Ingreso programado: mismos campos que el gasto programado. */
export type StoredScheduledIncome = StoredScheduledExpense;

export interface StoredCreditCard {
  id: string;
  name: string;
  dueDay: number;
  /** Día de corte del extracto; ausente o null en tarjetas anteriores a esta opción. */
  cutDay?: number | null;
  paymentAccountId: string;
  feeKind: 'NONE' | 'FIXED_MONTHLY' | 'ON_MOVEMENT';
  feeAmount: string | null;
  currency: string;
  rateBasis: 'MV' | 'EA' | null;
  ratePpm: number | null;
  /** `YYYY-MM` */
  feeStartMonth: string;
  /** `YYYY-MM` */
  feesSettledThrough: string | null;
}

export interface StoredCardPurchase {
  id: string;
  cardId: string;
  description: string;
  category: string | null;
  amount: string;
  currency: string;
  installments: number;
  purchaseDate: string;
  firstDueDate: string;
  monthlyRatePpm: number;
  paidInstallments: number;
  closedOn: string | null;
  /** Día de pago de la tarjeta al crear la compra. Las filas anteriores a este campo no lo traen. */
  dueDayAnchor?: number | null;
}

/** Una parte de un pago de tarjeta, con los montos como string de bigint. */
export type StoredAllocation =
  | { kind: 'INSTALLMENT'; purchaseId: string; number: number; interest: string; capital: string }
  | { kind: 'EXTRA'; purchaseId: string; capital: string }
  | { kind: 'FEE'; month: string; amount: string };

/** Pago a una tarjeta (evento) con su reparto. */
export interface StoredCardPayment {
  id: string;
  cardId: string;
  /** Orden del pago dentro de la tarjeta, desde 1. */
  seq: number;
  /** ISO 8601 completo del día del pago (medianoche UTC). */
  paidOn: string;
  fromAccountId: string;
  total: string;
  currency: string;
  extraMode: 'SHORTEN' | 'LOWER' | null;
  allocations: StoredAllocation[];
  transactionIds: string[];
}

export interface FinanzasSchema extends DBSchema {
  accounts: { key: string; value: StoredAccount };
  transactions: {
    key: string;
    value: StoredTransaction;
    indexes: { 'by-date': string; 'by-account-date': string };
  };
  scheduledExpenses: {
    key: string;
    value: StoredScheduledExpense;
    indexes: { 'by-account': string };
  };
  scheduledIncomes: {
    key: string;
    value: StoredScheduledIncome;
    indexes: { 'by-account': string };
  };
  creditCards: { key: string; value: StoredCreditCard };
  cardPurchases: {
    key: string;
    value: StoredCardPurchase;
    indexes: { 'by-card': string };
  };
  cardPayments: {
    key: string;
    value: StoredCardPayment;
    indexes: { 'by-card': [string, number] };
  };
  meta: { key: string; value: { key: string; value: unknown } };
}

export type FinanzasDb = IDBPDatabase<FinanzasSchema>;

export interface OpenHooks {
  /** Otra ventana con la versión anterior sigue abierta y impide terminar de actualizar. */
  onBlocked?: () => void;
}

/**
 * Abre la base aplicando las actualizaciones por versión. Cada paso sólo AGREGA almacenes:
 * nunca toca ni borra los que ya existen, así los datos del teléfono quedan intactos.
 */
export function openFinanzasDb(name: string = DB_NAME, hooks: OpenHooks = {}): Promise<FinanzasDb> {
  return openDB<FinanzasSchema>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('accounts', { keyPath: 'id' });

        const transactions = db.createObjectStore('transactions', { keyPath: 'id' });
        // Historial general: recorre por fecha sin ordenar en memoria.
        transactions.createIndex('by-date', 'date');
        // Historial por cuenta: una entrada por cuenta involucrada (multiEntry).
        transactions.createIndex('by-account-date', 'accountDates', { multiEntry: true });

        const scheduled = db.createObjectStore('scheduledExpenses', { keyPath: 'id' });
        scheduled.createIndex('by-account', 'accountId');

        db.createObjectStore('meta', { keyPath: 'key' });
      }
      if (oldVersion < 2) {
        db.createObjectStore('scheduledIncomes', { keyPath: 'id' }).createIndex('by-account', 'accountId');
        db.createObjectStore('creditCards', { keyPath: 'id' });
        db.createObjectStore('cardPurchases', { keyPath: 'id' }).createIndex('by-card', 'cardId');
      }
      if (oldVersion < 3) {
        // Pagos de tarjeta por tarjeta y orden; el índice único impide dos pagos con el mismo orden.
        db.createObjectStore('cardPayments', { keyPath: 'id' }).createIndex('by-card', ['cardId', 'seq'], { unique: true });
      }
    },
    blocked() {
      hooks.onBlocked?.();
    },
    blocking(_current, _next, event) {
      // Otra pestaña necesita actualizar la base: soltamos esta conexión para dejarla pasar.
      (event.target as IDBDatabase).close();
    },
  });
}
