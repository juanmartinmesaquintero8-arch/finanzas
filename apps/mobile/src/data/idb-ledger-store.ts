import type { Account, CardPayment, CardPurchase, CreditCard, ScheduledExpense, ScheduledIncome, Transaction } from '@finanzas/domain';
import type { IDBPTransaction, StoreNames } from 'idb';
import type {
  FinanzasDb,
  FinanzasSchema,
  StoredCardPayment,
  StoredCardPurchase,
  StoredCreditCard,
  StoredTransaction,
} from './database';
import { cardPaymentRange } from './idb-card.repository';
import {
  toAccount,
  toCardPayment,
  toCardPurchase,
  toCreditCard,
  toIncome,
  toScheduled,
  toStoredAccount,
  toStoredCardPayment,
  toStoredCardPurchase,
  toStoredCreditCard,
  toStoredIncome,
  toStoredScheduled,
  toStoredTransaction,
  toTransaction,
} from './mappers';

export interface LedgerSnapshot {
  accounts: Account[];
  transactions: Transaction[];
  scheduledExpenses: ScheduledExpense[];
  scheduledIncomes: ScheduledIncome[];
  creditCards: CreditCard[];
  cardPurchases: CardPurchase[];
  cardPayments: CardPayment[];
}

type CardStore = 'creditCards' | 'cardPurchases' | 'cardPayments';

/** Lo que se reescribe en `replaceAll`: las tarjetas pueden venir aparte, como filas, en `extras`. */
export type LedgerWrite = Omit<LedgerSnapshot, CardStore> & Partial<Pick<LedgerSnapshot, CardStore>>;

/** Filas de los almacenes de tarjetas, tal como se guardan. */
export interface ExtraRows {
  creditCards: StoredCreditCard[];
  cardPurchases: StoredCardPurchase[];
  cardPayments: StoredCardPayment[];
}

/** Resultado de guardar un pago de tarjeta: guardado, ya estaba (doble toque) o la tarjeta cambió entretanto. */
export type CardPaymentWrite = 'written' | 'already' | 'changed';

/** Filas por lectura al recorrer el historial para las gráficas. */
const SCAN_BATCH = 5000;

const CARD_STORES = ['creditCards', 'cardPurchases', 'cardPayments'] as const;
const DATA_STORES = ['accounts', 'transactions', 'scheduledExpenses', 'scheduledIncomes', ...CARD_STORES] as const;

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

/** Dentro de una transacción: ¿la tarjeta ya tiene algún pago único? (los pagos del sistema anterior ya no se mezclan). */
async function hasCardPayments(tx: WriteTx, cardId: string): Promise<boolean> {
  return (await tx.objectStore('cardPayments').index('by-card').count(cardPaymentRange(cardId))) > 0;
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

  /** Guarda los ingresos reales y marca el ingreso programado como recibido, todo o nada. */
  receive(received: ScheduledIncome, realTransactions: readonly Transaction[]): Promise<void> {
    return atomically(this.db, ['transactions', 'scheduledIncomes'], (tx, track) => {
      for (const t of realTransactions) track(tx.objectStore('transactions').put(toStoredTransaction(t)));
      track(tx.objectStore('scheduledIncomes').put(toStoredIncome(received)));
    });
  }

  /**
   * Pago de tarjeta (cuota, deshacer o liquidar) en una sola escritura: guarda los movimientos, borra los
   * indicados y actualiza la compra. Dentro de la misma transacción comprueba que la compra siga como se
   * leyó y que la tarjeta no tenga pagos únicos: si no, no escribe nada y devuelve false.
   */
  async writeCardPayment(before: CardPurchase, after: CardPurchase, put: readonly Transaction[], remove: readonly string[] = []): Promise<boolean> {
    let applied = false;
    await atomically(this.db, ['transactions', 'cardPurchases', 'cardPayments'], (tx, track) => {
      const purchases = tx.objectStore('cardPurchases');
      const transactions = tx.objectStore('transactions');
      track(
        Promise.all([purchases.get(before.id), hasCardPayments(tx, before.cardId)]).then(([row, locked]) => {
          if (locked || !row || row.paidInstallments !== before.paidInstallments || !!row.closedOn !== before.isClosed) return;
          for (const t of put) track(transactions.put(toStoredTransaction(t)));
          for (const id of remove) track(transactions.delete(id));
          track(purchases.put(toStoredCardPurchase(after)));
          applied = true;
        }),
      );
    });
    return applied;
  }

  /** Pago de cuota de manejo: guarda el gasto y el mes pagado juntos; si la tarjeta cambió o ya tiene pagos únicos, no escribe nada. */
  async writeFeePayment(before: CreditCard, after: CreditCard, payment: Transaction): Promise<boolean> {
    let applied = false;
    await atomically(this.db, ['transactions', 'creditCards', 'cardPayments'], (tx, track) => {
      const cards = tx.objectStore('creditCards');
      track(
        Promise.all([cards.get(before.id), hasCardPayments(tx, before.id)]).then(([row, locked]) => {
          if (locked || !row || (row.feesSettledThrough ?? undefined) !== before.feesSettledThrough) return;
          track(tx.objectStore('transactions').put(toStoredTransaction(payment)));
          track(cards.put(toStoredCreditCard(after)));
          applied = true;
        }),
      );
    });
    return applied;
  }

  /** Deshace un pago de manejo: borra el gasto y retrocede el mes pagado juntos; si la tarjeta cambió o ya tiene pagos únicos, no escribe nada. */
  async writeFeeUndo(before: CreditCard, after: CreditCard, paymentId: string): Promise<boolean> {
    let applied = false;
    await atomically(this.db, ['transactions', 'creditCards', 'cardPayments'], (tx, track) => {
      const cards = tx.objectStore('creditCards');
      track(
        Promise.all([cards.get(before.id), hasCardPayments(tx, before.id)]).then(([row, locked]) => {
          if (locked || !row || (row.feesSettledThrough ?? undefined) !== before.feesSettledThrough) return;
          track(tx.objectStore('transactions').delete(paymentId));
          track(cards.put(toStoredCreditCard(after)));
          applied = true;
        }),
      );
    });
    return applied;
  }

  /**
   * Pago único de una tarjeta: guarda el evento y sus movimientos en una sola transacción. Dentro de ella:
   * si ya existe un pago con ese id no escribe nada ("already", un doble toque); si el último orden de la
   * tarjeta no es `expectedLastSeq` (otro pago o un deshacer se cruzó), tampoco ("changed").
   */
  async writeCardPaymentEvent(expectedLastSeq: number, payment: CardPayment, transactions: readonly Transaction[]): Promise<CardPaymentWrite> {
    if (payment.seq !== expectedLastSeq + 1) throw new Error('El orden del pago no sigue al último de la tarjeta.');
    let result: CardPaymentWrite = 'changed';
    await atomically(this.db, ['transactions', 'cardPayments'], (tx, track) => {
      const payments = tx.objectStore('cardPayments');
      const lastOfCard = payments.index('by-card').openCursor(cardPaymentRange(payment.cardId), 'prev');
      track(
        Promise.all([payments.getKey(payment.id), lastOfCard]).then(([existing, last]) => {
          if (existing !== undefined) {
            result = 'already';
            return;
          }
          if ((last?.value.seq ?? 0) !== expectedLastSeq) return;
          // `add` (no `put`): si un movimiento ya existiera, falla y se cancela todo.
          for (const t of transactions) track(tx.objectStore('transactions').add(toStoredTransaction(t)));
          track(payments.add(toStoredCardPayment(payment)));
          result = 'written';
        }),
      );
    });
    return result;
  }

  /** Deshace un pago de tarjeta (evento y movimientos) en una sola transacción, solo si es el último de su tarjeta. */
  async removeCardPaymentEvent(payment: CardPayment): Promise<boolean> {
    let applied = false;
    await atomically(this.db, ['transactions', 'cardPayments'], (tx, track) => {
      const payments = tx.objectStore('cardPayments');
      track(
        payments.index('by-card').openCursor(cardPaymentRange(payment.cardId), 'prev').then((last) => {
          if (!last || last.value.id !== payment.id) return;
          for (const id of last.value.transactionIds) track(tx.objectStore('transactions').delete(id));
          track(payments.delete(payment.id));
          applied = true;
        }),
      );
    });
    return applied;
  }

  /** Ids de todos los pagos de manejo (`cf-…`), sin leer las filas. */
  async feePaymentIds(): Promise<string[]> {
    return this.db.getAllKeys('transactions', IDBKeyRange.bound('cf-', 'cf-\uffff'));
  }

  /** Borra la tarjeta, sus compras y sus pagos (eventos), todo o nada. Los movimientos reales se conservan. */
  deleteCard(cardId: string): Promise<void> {
    return atomically(this.db, [...CARD_STORES], (tx, track) => {
      const purchases = tx.objectStore('cardPurchases');
      const payments = tx.objectStore('cardPayments');
      track(tx.objectStore('creditCards').delete(cardId));
      track(
        purchases.index('by-card').getAllKeys(cardId).then((keys) => {
          for (const key of keys) track(purchases.delete(key));
        }),
      );
      track(
        payments.index('by-card').getAllKeys(cardPaymentRange(cardId)).then((keys) => {
          for (const key of keys) track(payments.delete(key));
        }),
      );
    });
  }

  async readAll(): Promise<LedgerSnapshot> {
    const tx = this.db.transaction([...DATA_STORES], 'readonly');
    const [accounts, transactions, scheduledExpenses, scheduledIncomes, creditCards, cardPurchases, cardPayments] = await Promise.all([
      tx.objectStore('accounts').getAll(),
      tx.objectStore('transactions').getAll(),
      tx.objectStore('scheduledExpenses').getAll(),
      tx.objectStore('scheduledIncomes').getAll(),
      tx.objectStore('creditCards').getAll(),
      tx.objectStore('cardPurchases').getAll(),
      tx.objectStore('cardPayments').getAll(),
      tx.done,
    ]);
    return {
      accounts: accounts.map(toAccount),
      transactions: transactions.map(toTransaction),
      scheduledExpenses: scheduledExpenses.map(toScheduled),
      scheduledIncomes: scheduledIncomes.map(toIncome),
      creditCards: creditCards.map(toCreditCard),
      cardPurchases: cardPurchases.map(toCardPurchase),
      cardPayments: cardPayments.map(toCardPayment),
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

  /** Lee las filas de los almacenes de tarjetas, compras y pagos de tarjeta (para conservarlas al reescribir el resto). */
  async readExtras(): Promise<ExtraRows> {
    const tx = this.db.transaction([...CARD_STORES], 'readonly');
    const [creditCards, cardPurchases, cardPayments] = await Promise.all([
      tx.objectStore('creditCards').getAll(),
      tx.objectStore('cardPurchases').getAll(),
      tx.objectStore('cardPayments').getAll(),
      tx.done,
    ]);
    return { creditCards, cardPurchases, cardPayments };
  }

  /**
   * Reemplaza todos los datos por los recibidos (restaurar copia), en una sola transacción.
   * Las tarjetas, compras y pagos de tarjeta quedan con los de `snapshot` o las filas de `extras`;
   * sin ninguno (copia que no los trae), vacíos.
   */
  replaceAll(snapshot: LedgerWrite, extras: Partial<ExtraRows> = {}): Promise<void> {
    return atomically(this.db, [...DATA_STORES], (tx, track) => {
      const accounts = tx.objectStore('accounts');
      const transactions = tx.objectStore('transactions');
      const scheduled = tx.objectStore('scheduledExpenses');
      const incomes = tx.objectStore('scheduledIncomes');
      track(accounts.clear());
      track(transactions.clear());
      track(scheduled.clear());
      track(incomes.clear());
      for (const store of CARD_STORES) {
        track(tx.objectStore(store).clear());
        for (const row of extras[store] ?? []) track(tx.objectStore(store).put(row as never));
      }
      for (const c of snapshot.creditCards ?? []) track(tx.objectStore('creditCards').put(toStoredCreditCard(c)));
      for (const p of snapshot.cardPurchases ?? []) track(tx.objectStore('cardPurchases').put(toStoredCardPurchase(p)));
      for (const p of snapshot.cardPayments ?? []) track(tx.objectStore('cardPayments').put(toStoredCardPayment(p)));
      for (const a of snapshot.accounts) track(accounts.put(toStoredAccount(a)));
      for (const t of snapshot.transactions) track(transactions.put(toStoredTransaction(t)));
      for (const s of snapshot.scheduledExpenses) track(scheduled.put(toStoredScheduled(s)));
      for (const i of snapshot.scheduledIncomes) track(incomes.put(toStoredIncome(i)));
    });
  }

  /** Borra todos los datos (cuentas, movimientos, programados, tarjetas, compras y pagos de tarjeta). Conserva los ajustes (meta). */
  clearAll(): Promise<void> {
    return this.replaceAll({ accounts: [], transactions: [], scheduledExpenses: [], scheduledIncomes: [] });
  }

  async getMeta<T = unknown>(key: string): Promise<T | undefined> {
    return (await this.db.get('meta', key))?.value as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.db.put('meta', { key, value });
  }
}
