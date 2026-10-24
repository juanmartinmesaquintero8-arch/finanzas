import type { Account, CreateAccountInput, CreateScheduledExpenseInput, CreateTransactionInput, Projection, ScheduledExpense, Summary, Transaction, TransactionPage, UpdateAccountInput } from '@finanzas/ui';

/** Tags de caché de Next.js (CLAUDE.md §7.3). Las Server Actions los invalidan con revalidateTag. */
export const CACHE_TAGS = {
  summary: 'summary',
  projection: 'projection',
  accounts: 'accounts',
  transactions: 'transactions',
  scheduled: 'scheduled',
} as const;

/** Red de seguridad: TTL corto; el mecanismo principal es la invalidación por tag. */
const SAFETY_TTL_SECONDS = 30;

const GENERIC_ERROR = 'Ocurrió un error inesperado. Intenta de nuevo.';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly messages: string[],
  ) {
    super(messages.join('. '));
    this.name = 'ApiError';
  }
}

export class NetworkError extends Error {
  constructor() {
    super('No pudimos conectarnos con el servidor. Revisa que la aplicación esté encendida.');
    this.name = 'NetworkError';
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
}

type NextInit = RequestInit & { next?: { tags: string[]; revalidate?: number } };

async function toApiError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { message?: string | string[] };
    const messages = Array.isArray(body.message) ? body.message : body.message ? [body.message] : [];
    return new ApiError(res.status, messages.length ? messages : [GENERIC_ERROR]);
  } catch {
    return new ApiError(res.status, [GENERIC_ERROR]);
  }
}

export function createApiClient({ baseUrl, fetch: fetchImpl = fetch }: ApiClientOptions) {
  const base = baseUrl.replace(/\/+$/, '');

  async function request(path: string, init: NextInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, init);
    } catch {
      throw new NetworkError();
    }
    if (!res.ok) throw await toApiError(res);
    return res;
  }

  const read = async <T>(path: string, tag: string): Promise<T> =>
    (await request(path, { next: { tags: [tag], revalidate: SAFETY_TTL_SECONDS } })).json() as Promise<T>;

  const write = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await request(path, {
      method,
      cache: 'no-store',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return (res.status === 204 ? undefined : await res.json()) as T;
  };

  return {
    getSummary: () => read<Summary>('/summary', CACHE_TAGS.summary),
    getProjection: (to: string) => read<Projection>(`/projection?to=${encodeURIComponent(to)}`, CACHE_TAGS.projection),
    listAccounts: () => read<Account[]>('/accounts', CACHE_TAGS.accounts),
    createAccount: (input: CreateAccountInput) => write<Account>('POST', '/accounts', input),
    updateAccount: (id: string, input: UpdateAccountInput) =>
      write<Account>('PATCH', `/accounts/${encodeURIComponent(id)}`, input),

    listTransactions: (query: { accountId?: string; limit?: number; cursor?: string } = {}) => {
      const params = new URLSearchParams();
      if (query.accountId) params.set('accountId', query.accountId);
      if (query.limit) params.set('limit', String(query.limit));
      if (query.cursor) params.set('cursor', query.cursor);
      const qs = params.toString();
      return read<TransactionPage>(`/transactions${qs ? `?${qs}` : ''}`, CACHE_TAGS.transactions);
    },
    getTransaction: (id: string) => read<Transaction>(`/transactions/${encodeURIComponent(id)}`, CACHE_TAGS.transactions),
    createTransaction: (input: CreateTransactionInput) => write<Transaction>('POST', '/transactions', input),
    updateTransaction: (id: string, input: CreateTransactionInput) =>
      write<Transaction>('PUT', `/transactions/${encodeURIComponent(id)}`, input),
    deleteTransaction: (id: string) => write<void>('DELETE', `/transactions/${encodeURIComponent(id)}`),

    listScheduledExpenses: () => read<ScheduledExpense[]>('/scheduled-expenses', CACHE_TAGS.scheduled),
    createScheduledExpense: (input: CreateScheduledExpenseInput) =>
      write<ScheduledExpense>('POST', '/scheduled-expenses', input),
    updateScheduledExpense: (id: string, input: CreateScheduledExpenseInput) =>
      write<ScheduledExpense>('PUT', `/scheduled-expenses/${encodeURIComponent(id)}`, input),
    deleteScheduledExpense: (id: string) => write<void>('DELETE', `/scheduled-expenses/${encodeURIComponent(id)}`),
    settleScheduledExpense: (id: string, through: string) =>
      write<ScheduledExpense>('POST', `/scheduled-expenses/${encodeURIComponent(id)}/settle`, {
        through,
        createTransactions: true,
      }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** Cliente por defecto (servidor y Server Actions). */
export function getApiClient(): ApiClient {
  return createApiClient({ baseUrl: process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001' });
}
