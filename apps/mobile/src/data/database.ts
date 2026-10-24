import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export const DB_NAME = 'mis-finanzas';
export const DB_VERSION = 1;

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
  meta: { key: string; value: { key: string; value: unknown } };
}

export type FinanzasDb = IDBPDatabase<FinanzasSchema>;

export function openFinanzasDb(name: string = DB_NAME): Promise<FinanzasDb> {
  return openDB<FinanzasSchema>(name, DB_VERSION, {
    upgrade(db) {
      db.createObjectStore('accounts', { keyPath: 'id' });

      const transactions = db.createObjectStore('transactions', { keyPath: 'id' });
      // Historial general: recorre por fecha sin ordenar en memoria.
      transactions.createIndex('by-date', 'date');
      // Historial por cuenta: una entrada por cuenta involucrada (multiEntry).
      transactions.createIndex('by-account-date', 'accountDates', { multiEntry: true });

      const scheduled = db.createObjectStore('scheduledExpenses', { keyPath: 'id' });
      scheduled.createIndex('by-account', 'accountId');

      db.createObjectStore('meta', { keyPath: 'key' });
    },
  });
}
