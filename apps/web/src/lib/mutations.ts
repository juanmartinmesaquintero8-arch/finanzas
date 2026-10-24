import type { ActionResult } from './action-result';
import { ApiError, CACHE_TAGS, NetworkError, type ApiClient } from './api-client';
import type {
  CreateAccountInput,
  CreateScheduledExpenseInput,
  CreateTransactionInput,
  TransactionPage,
} from './types';

type Revalidate = (tag: string) => void;

const { summary, projection, accounts, transactions, scheduled } = CACHE_TAGS;

/**
 * Casos de uso de escritura de la web. Cada mutación exitosa invalida los tags de
 * los datos que cambió (CLAUDE.md §7.3); si falla no invalida nada.
 */
export function createMutations(client: ApiClient, revalidate: Revalidate) {
  async function run(action: () => Promise<unknown>, affected: string[]): Promise<ActionResult> {
    try {
      await action();
    } catch (e) {
      if (e instanceof ApiError || e instanceof NetworkError) return { ok: false, error: e.message };
      return { ok: false, error: 'Ocurrió un error inesperado. Intenta de nuevo.' };
    }
    affected.forEach(revalidate);
    return { ok: true };
  }

  return {
    createTransaction: (input: CreateTransactionInput) =>
      run(() => client.createTransaction(input), [transactions, summary, projection]),
    deleteTransaction: (id: string) => run(() => client.deleteTransaction(id), [transactions, summary, projection]),
    createAccount: (input: CreateAccountInput) => run(() => client.createAccount(input), [accounts, summary, projection]),
    createScheduledExpense: (input: CreateScheduledExpenseInput) =>
      run(() => client.createScheduledExpense(input), [scheduled, projection]),
    deleteScheduledExpense: (id: string) => run(() => client.deleteScheduledExpense(id), [scheduled, projection]),
    settleScheduledExpense: (id: string, through: string) =>
      run(() => client.settleScheduledExpense(id, through), [scheduled, transactions, summary, projection]),
    /** Lectura paginada por cursor para "Cargar más" (nunca offset). */
    loadTransactions: (params: { accountId?: string; cursor: string }): Promise<TransactionPage> =>
      client.listTransactions({ accountId: params.accountId, cursor: params.cursor, limit: 20 }),
  };
}
