import { describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError, type ApiClient } from './api-client';
import { createMutations } from './mutations';

function setup(overrides: Partial<Record<keyof ApiClient, unknown>> = {}) {
  const client = {
    createTransaction: vi.fn().mockResolvedValue({}),
    deleteTransaction: vi.fn().mockResolvedValue(undefined),
    createAccount: vi.fn().mockResolvedValue({}),
    createScheduledExpense: vi.fn().mockResolvedValue({}),
    deleteScheduledExpense: vi.fn().mockResolvedValue(undefined),
    settleScheduledExpense: vi.fn().mockResolvedValue({}),
    listTransactions: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    ...overrides,
  } as unknown as ApiClient;
  const revalidate = vi.fn();
  return { client, revalidate, m: createMutations(client, revalidate) };
}

const tags = (revalidate: ReturnType<typeof vi.fn>) => revalidate.mock.calls.map((c) => c[0]).sort();

describe('mutaciones invalidan los tags afectados (CLAUDE.md §7.3)', () => {
  it('crear transacción -> transactions, summary, projection', async () => {
    const { m, revalidate, client } = setup();
    const input = { type: 'EXPENSE', amount: '1', date: '2026-01-01', description: 'x', accountId: 'a' } as const;
    expect(await m.createTransaction(input)).toEqual({ ok: true });
    expect(client.createTransaction).toHaveBeenCalledWith(input);
    expect(tags(revalidate)).toEqual(['projection', 'summary', 'transactions']);
  });

  it('eliminar transacción', async () => {
    const { m, revalidate } = setup();
    expect(await m.deleteTransaction('t1')).toEqual({ ok: true });
    expect(tags(revalidate)).toEqual(['projection', 'summary', 'transactions']);
  });

  it('crear cuenta -> accounts, summary, projection', async () => {
    const { m, revalidate } = setup();
    await m.createAccount({ name: 'Nu', type: 'DIGITAL', initialBalance: '0' });
    expect(tags(revalidate)).toEqual(['accounts', 'projection', 'summary']);
  });

  it('gastos programados: crear/eliminar -> scheduled, projection', async () => {
    const { m, revalidate } = setup();
    await m.createScheduledExpense({ description: 'a', amount: '1', accountId: 'a', frequency: 'ONCE', startDate: '2026-01-01' });
    expect(tags(revalidate)).toEqual(['projection', 'scheduled']);
    revalidate.mockClear();
    await m.deleteScheduledExpense('s1');
    expect(tags(revalidate)).toEqual(['projection', 'scheduled']);
  });

  it('liquidar crea movimientos reales -> también transactions y summary', async () => {
    const { m, revalidate, client } = setup();
    await m.settleScheduledExpense('s1', '2026-03-10');
    expect(client.settleScheduledExpense).toHaveBeenCalledWith('s1', '2026-03-10');
    expect(tags(revalidate)).toEqual(['projection', 'scheduled', 'summary', 'transactions']);
  });

  it('un error de la API devuelve {ok:false} en español y NO invalida', async () => {
    const { m, revalidate } = setup({ createTransaction: vi.fn().mockRejectedValue(new ApiError(422, ['Monto inválido'])) });
    const res = await m.createTransaction({ type: 'INCOME', amount: '1', date: '2026-01-01', description: 'x', accountId: 'a' });
    expect(res).toEqual({ ok: false, error: 'Monto inválido' });
    expect(revalidate).not.toHaveBeenCalled();
  });

  it('error de red también es amable', async () => {
    const { m } = setup({ deleteTransaction: vi.fn().mockRejectedValue(new NetworkError()) });
    const res = await m.deleteTransaction('t');
    expect(res.ok).toBe(false);
  });

  it('un error desconocido da mensaje genérico', async () => {
    const { m } = setup({ deleteTransaction: vi.fn().mockRejectedValue(new Error('boom')) });
    expect(await m.deleteTransaction('t')).toEqual({ ok: false, error: 'Ocurrió un error inesperado. Intenta de nuevo.' });
  });

  it('loadTransactions pasa el cursor tal cual', async () => {
    const { m, client } = setup();
    await m.loadTransactions({ accountId: 'a', cursor: 'c' });
    expect(client.listTransactions).toHaveBeenCalledWith({ accountId: 'a', cursor: 'c', limit: 20 });
  });
});
