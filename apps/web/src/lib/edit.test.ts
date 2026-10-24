import { describe, expect, it, vi } from 'vitest';
import { createApiClient, type ApiClient } from './api-client';
import { createMutations } from './mutations';
import { validateScheduledForm } from './validation';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function apiSetup() {
  const fetchMock = vi.fn(async () => jsonResponse({}));
  const client = createApiClient({ baseUrl: 'http://api.test/', fetch: fetchMock as unknown as typeof fetch });
  type Init = RequestInit & { next?: { tags: string[] } };
  const last = () => fetchMock.mock.calls[0] as unknown as [string, Init];
  return { client, last };
}

describe('api-client: edición', () => {
  it('getTransaction hace GET /transactions/:id con tag "transactions"', async () => {
    const { client, last } = apiSetup();
    await client.getTransaction('t 1');
    const [url, init] = last();
    expect(url).toBe('http://api.test/transactions/t%201');
    expect(init.next?.tags).toEqual(['transactions']);
  });

  it('updateTransaction hace PUT con el cuerpo y sin caché', async () => {
    const { client, last } = apiSetup();
    const input = { type: 'EXPENSE', amount: '5', date: '2026-01-01', description: 'x', accountId: 'a' } as const;
    await client.updateTransaction('t1', input);
    const [url, init] = last();
    expect(url).toBe('http://api.test/transactions/t1');
    expect(init.method).toBe('PUT');
    expect(init.cache).toBe('no-store');
    expect(JSON.parse(init.body as string)).toEqual(input);
  });

  it('updateAccount hace PATCH /accounts/:id', async () => {
    const { client, last } = apiSetup();
    await client.updateAccount('a1', { name: 'Nu', type: 'DIGITAL', initialBalance: '10' });
    const [url, init] = last();
    expect(url).toBe('http://api.test/accounts/a1');
    expect(init.method).toBe('PATCH');
  });

  it('updateScheduledExpense hace PUT /scheduled-expenses/:id', async () => {
    const { client, last } = apiSetup();
    await client.updateScheduledExpense('s1', { description: 'x', amount: '1', accountId: 'a', frequency: 'ONCE', startDate: '2026-01-01' });
    const [url, init] = last();
    expect(url).toBe('http://api.test/scheduled-expenses/s1');
    expect(init.method).toBe('PUT');
  });
});

describe('mutaciones de edición invalidan los tags afectados', () => {
  function setup() {
    const client = {
      updateTransaction: vi.fn().mockResolvedValue({}),
      updateAccount: vi.fn().mockResolvedValue({}),
      updateScheduledExpense: vi.fn().mockResolvedValue({}),
    } as unknown as ApiClient;
    const revalidate = vi.fn();
    const tags = () => revalidate.mock.calls.map((c) => c[0]).sort();
    return { client, revalidate, tags, m: createMutations(client, revalidate) };
  }

  it('editar transacción -> transactions, summary, projection', async () => {
    const { m, client, tags } = setup();
    const input = { type: 'INCOME', amount: '1', date: '2026-01-01', description: 'x', accountId: 'a' } as const;
    expect(await m.updateTransaction('t1', input)).toEqual({ ok: true });
    expect(client.updateTransaction).toHaveBeenCalledWith('t1', input);
    expect(tags()).toEqual(['projection', 'summary', 'transactions']);
  });

  it('editar cuenta -> accounts, summary, projection', async () => {
    const { m, tags } = setup();
    expect(await m.updateAccount('a1', { name: 'Nu', type: 'DIGITAL', initialBalance: '0' })).toEqual({ ok: true });
    expect(tags()).toEqual(['accounts', 'projection', 'summary']);
  });

  it('editar gasto programado -> scheduled, projection', async () => {
    const { m, tags } = setup();
    const input = { description: 'x', amount: '1', accountId: 'a', frequency: 'ONCE', startDate: '2026-01-01' } as const;
    expect(await m.updateScheduledExpense('s1', input)).toEqual({ ok: true });
    expect(tags()).toEqual(['projection', 'scheduled']);
  });

  it('si falla no invalida nada y devuelve el error', async () => {
    const client = { updateTransaction: vi.fn().mockRejectedValue(new Error('boom')) } as unknown as ApiClient;
    const revalidate = vi.fn();
    const res = await createMutations(client, revalidate).updateTransaction('t1', {
      type: 'INCOME', amount: '1', date: '2026-01-01', description: 'x', accountId: 'a',
    });
    expect(res.ok).toBe(false);
    expect(revalidate).not.toHaveBeenCalled();
  });
});

describe('validateScheduledForm: fecha de fin', () => {
  const base = { description: 'Arriendo', amountText: '100', accountId: 'a', frequency: 'MONTHLY' as const, startDate: '2026-03-01' };

  it('incluye endDate cuando se escribe', () => {
    const res = validateScheduledForm({ ...base, endDate: '2026-12-01' });
    expect(res).toMatchObject({ ok: true, value: { endDate: '2026-12-01' } });
  });

  it('no incluye endDate si está vacío', () => {
    const res = validateScheduledForm({ ...base, endDate: '' });
    expect(res.ok && 'endDate' in res.value).toBe(false);
  });

  it('rechaza un fin anterior al inicio', () => {
    const res = validateScheduledForm({ ...base, endDate: '2026-01-01' });
    expect(res).toMatchObject({ ok: false, errors: { endDate: expect.any(String) } });
  });
});
