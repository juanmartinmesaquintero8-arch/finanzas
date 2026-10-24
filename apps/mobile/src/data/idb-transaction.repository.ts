import type {
  Transaction,
  TransactionPageQuery,
  TransactionQuery,
  TransactionRepository,
} from '@finanzas/domain';
import type { FinanzasDb, StoredTransaction } from './database';
import { accountDateKey, accountDateRange, toStoredTransaction, toTransaction } from './mappers';

/** Adaptador IndexedDB del puerto TransactionRepository. */
export class IdbTransactionRepository implements TransactionRepository {
  constructor(private readonly db: FinanzasDb) {}

  async findAll(query: TransactionQuery = {}): Promise<Transaction[]> {
    let rows: StoredTransaction[];
    if (query.accountId) {
      const { lower, upper } = accountDateRange(query.accountId);
      rows = await this.db.getAllFromIndex('transactions', 'by-account-date', IDBKeyRange.bound(lower, upper));
    } else if (query.from || query.to) {
      const lower = query.from?.toISOString();
      const upper = query.to?.toISOString();
      const range =
        lower && upper ? IDBKeyRange.bound(lower, upper) : lower ? IDBKeyRange.lowerBound(lower) : IDBKeyRange.upperBound(upper!);
      rows = await this.db.getAllFromIndex('transactions', 'by-date', range);
    } else {
      rows = await this.db.getAll('transactions');
    }
    const from = query.from?.toISOString();
    const to = query.to?.toISOString();
    return rows.filter((r) => (!from || r.date >= from) && (!to || r.date <= to)).map(toTransaction);
  }

  async findById(id: string): Promise<Transaction | null> {
    const row = await this.db.get('transactions', id);
    return row ? toTransaction(row) : null;
  }

  /**
   * Página keyset (sin saltar filas): recorre el índice por fecha de más nuevo a más viejo
   * y, dentro de un mismo instante, ordena por id ascendente (igual que el contrato del puerto).
   */
  async findPage({ accountId, limit, after }: TransactionPageQuery): Promise<Transaction[]> {
    const afterDate = after?.date.toISOString();
    let range: IDBKeyRange | undefined;
    if (accountId) {
      const { lower, upper } = accountDateRange(accountId);
      range = IDBKeyRange.bound(lower, afterDate ? accountDateKey(accountId, afterDate) : upper);
    } else if (afterDate) {
      range = IDBKeyRange.upperBound(afterDate);
    }

    const tx = this.db.transaction('transactions', 'readonly');
    const index = accountId ? tx.store.index('by-account-date') : tx.store.index('by-date');
    const result: StoredTransaction[] = [];
    let group: StoredTransaction[] = [];
    const flush = () => {
      group.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      result.push(...group);
      group = [];
    };

    let cursor = await index.openCursor(range, 'prev');
    while (cursor) {
      const row = cursor.value;
      // Ya entregado en la página anterior: mismo instante y id menor o igual al del cursor.
      const seen = after && row.date === afterDate && row.id <= after.id;
      if (!seen) {
        if (group.length > 0 && group[0]!.date !== row.date) {
          flush();
          if (result.length >= limit) break;
        }
        group.push(row);
      }
      cursor = await cursor.continue();
    }
    // Tras cortar por límite el grupo ya está vacío; si se acabó el índice queda el último grupo.
    if (group.length > 0) flush();
    await tx.done;
    return result.slice(0, limit).map(toTransaction);
  }

  /** Equivalente a SUM ... GROUP BY: recorre las filas una vez, sin construir entidades. */
  async balanceDeltas(): Promise<Map<string, bigint>> {
    const deltas = new Map<string, bigint>();
    const add = (id: string | null, delta: bigint) => {
      if (id) deltas.set(id, (deltas.get(id) ?? 0n) + delta);
    };
    const tx = this.db.transaction('transactions', 'readonly');
    let cursor = await tx.store.openCursor();
    while (cursor) {
      const t = cursor.value;
      const amount = BigInt(t.amount);
      if (t.type === 'INCOME') add(t.accountId, amount);
      else if (t.type === 'EXPENSE') add(t.accountId, -amount);
      else {
        add(t.fromAccountId, -amount);
        add(t.toAccountId, amount);
      }
      cursor = await cursor.continue();
    }
    await tx.done;
    return deltas;
  }

  async save(transaction: Transaction): Promise<void> {
    await this.db.put('transactions', toStoredTransaction(transaction));
  }

  async saveMany(transactions: readonly Transaction[]): Promise<void> {
    const tx = this.db.transaction('transactions', 'readwrite');
    await Promise.all([...transactions.map((t) => tx.store.put(toStoredTransaction(t))), tx.done]);
  }

  async delete(id: string): Promise<void> {
    await this.db.delete('transactions', id);
  }
}
