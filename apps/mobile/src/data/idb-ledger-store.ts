import type { Account, ScheduledExpense, Transaction } from '@finanzas/domain';
import type { IDBPTransaction, StoreNames } from 'idb';
import type { FinanzasDb, FinanzasSchema, StoredTransaction } from './database';
import {
  toAccount,
  toScheduled,
  toStoredAccount,
  toStoredScheduled,
  toStoredTransaction,
  toTransaction,
} from './mappers';

export interface LedgerSnapshot {
  accounts: Account[];
  transactions: Transaction[];
  scheduledExpenses: ScheduledExpense[];
}

/** Filas por lectura al recorrer el historial para las gráficas. */
const SCAN_BATCH = 5000;

const DATA_STORES = ['accounts', 'transactions', 'scheduledExpenses'] as const;

type WriteTx = IDBPTransaction<FinanzasSchema, StoreNames<FinanzasSchema>[], 'readwrite'>;
type Track = (request: Promise<unknown>) => void;

/**
 * Ejecuta varias escrituras en una sola transacción de IndexedDB: si cualquiera falla
 * (incluso al armar la fila) se cancela todo y no queda nada a medias.
 */
async function atomically(
  db: FinanzasDb,
  stores: StoreNames<FinanzasSchema>[],
  work: (tx: WriteTx, track: Track) => void,
): Promise<void> {
  const tx = db.transaction(stores, 'readwrite') as WriteTx;
  const pending: Promise<unknown>[] = [];
  // Si se cancela, las peticiones en vuelo rechazan: se observan para que no queden sin atender.
  const track: Track = (request) => {
    request.catch(() => undefined);
    pending.push(request);
  };
  try {
    work(tx, track);
    await Promise.all([...pending, tx.done]);
  } catch (e) {
    try {
      tx.abort();
    } catch {
      /* ya estaba cerrada */
    }
    await tx.done.catch(() => undefined);
    throw e;
  }
}

/**
 * Operaciones que tocan varias tablas a la vez: liquidar un gasto programado,
 * restaurar o borrar todo. Cada una es todo o nada.
 */
export class IdbLedgerStore {
  constructor(private readonly db: FinanzasDb) {}

  /** Guarda los gastos reales y marca el programado como liquidado, todo o nada. */
  settle(settled: ScheduledExpense, realTransactions: readonly Transaction[]): Promise<void> {
    return atomically(this.db, ['transactions', 'scheduledExpenses'], (tx, track) => {
      for (const t of realTransactions) track(tx.objectStore('transactions').put(toStoredTransaction(t)));
      track(tx.objectStore('scheduledExpenses').put(toStoredScheduled(settled)));
    });
  }

  async readAll(): Promise<LedgerSnapshot> {
    const tx = this.db.transaction([...DATA_STORES], 'readonly');
    const [accounts, transactions, scheduledExpenses] = await Promise.all([
      tx.objectStore('accounts').getAll(),
      tx.objectStore('transactions').getAll(),
      tx.objectStore('scheduledExpenses').getAll(),
      tx.done,
    ]);
    return {
      accounts: accounts.map(toAccount),
      transactions: transactions.map(toTransaction),
      scheduledExpenses: scheduledExpenses.map(toScheduled),
    };
  }

  /**
   * Recorre los movimientos con fecha entre `from` y `upper` (claves ISO; basta un prefijo como '2026-02')
   * por lotes de `size`, sobre el índice por fecha y sin crear entidades. Cada lote se entrega a
   * `onBatch`, que puede ceder el hilo antes de pedir el siguiente.
   */
  async scanTransactionsByDate(
    from: string,
    upper: string,
    onBatch: (rows: StoredTransaction[]) => void | Promise<void>,
    size = SCAN_BATCH,
  ): Promise<void> {
    let range = IDBKeyRange.bound(from, upper);
    for (;;) {
      const rows = await this.db.getAllFromIndex('transactions', 'by-date', range, size);
      if (rows.length < size) {
        if (rows.length > 0) await onBatch(rows);
        return;
      }
      // Lote lleno: el último instante puede continuar en el siguiente, así que se deja para después.
      const lastDate = rows[rows.length - 1]!.date;
      const complete = rows.filter((r) => r.date !== lastDate);
      if (complete.length > 0) {
        await onBatch(complete);
        range = IDBKeyRange.bound(lastDate, upper);
      } else {
        // Todo el lote es un mismo instante: se lee completo y se sigue después de él.
        await onBatch(await this.db.getAllFromIndex('transactions', 'by-date', IDBKeyRange.only(lastDate)));
        range = IDBKeyRange.bound(lastDate, upper, true);
      }
    }
  }

  /** Reemplaza todos los datos por los recibidos (restaurar copia), en una sola transacción. */
  replaceAll(snapshot: LedgerSnapshot): Promise<void> {
    return atomically(this.db, [...DATA_STORES], (tx, track) => {
      const accounts = tx.objectStore('accounts');
      const transactions = tx.objectStore('transactions');
      const scheduled = tx.objectStore('scheduledExpenses');
      track(accounts.clear());
      track(transactions.clear());
      track(scheduled.clear());
      for (const a of snapshot.accounts) track(accounts.put(toStoredAccount(a)));
      for (const t of snapshot.transactions) track(transactions.put(toStoredTransaction(t)));
      for (const s of snapshot.scheduledExpenses) track(scheduled.put(toStoredScheduled(s)));
    });
  }

  /** Borra cuentas, movimientos y gastos programados. Conserva los ajustes (meta). */
  clearAll(): Promise<void> {
    return this.replaceAll({ accounts: [], transactions: [], scheduledExpenses: [] });
  }

  async getMeta<T = unknown>(key: string): Promise<T | undefined> {
    return (await this.db.get('meta', key))?.value as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.db.put('meta', { key, value });
  }
}
