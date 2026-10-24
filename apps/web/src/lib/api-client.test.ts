import { describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError, createApiClient } from './api-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function setup(response: Response | Error = jsonResponse({})) {
  const fetchMock = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  const client = createApiClient({ baseUrl: 'http://api.test/', fetch: fetchMock as unknown as typeof fetch });
  return { client, fetchMock };
}

describe('api-client lecturas', () => {
  it('GET /summary con tag "summary" y sin caché compartida', async () => {
    const { client, fetchMock } = setup(jsonResponse({ netWorth: { amount: '10', currency: 'COP' }, accounts: [] }));
    const result = await client.getSummary();
    expect(result.netWorth.amount).toBe('10');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit & { next?: { tags: string[] } }];
    expect(url).toBe('http://api.test/summary');
    expect(init.next?.tags).toEqual(['summary']);
  });

  it('GET /projection?to= con tag "projection"', async () => {
    const { client, fetchMock } = setup(jsonResponse({ isShortfall: false }));
    await client.getProjection('2026-03-31');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { next?: { tags: string[] } }];
    expect(url).toBe('http://api.test/projection?to=2026-03-31');
    expect(init.next?.tags).toEqual(['projection']);
  });

  it('listTransactions envía accountId, limit y cursor (nunca offset)', async () => {
    const { client, fetchMock } = setup(jsonResponse({ items: [], nextCursor: null }));
    await client.listTransactions({ accountId: 'a1', limit: 20, cursor: 'abc==' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { next?: { tags: string[] } }];
    const u = new URL(url);
    expect(u.pathname).toBe('/transactions');
    expect(u.searchParams.get('accountId')).toBe('a1');
    expect(u.searchParams.get('limit')).toBe('20');
    expect(u.searchParams.get('cursor')).toBe('abc==');
    expect(u.searchParams.has('offset')).toBe(false);
    expect(init.next?.tags).toEqual(['transactions']);
  });

  it('listTransactions sin filtros no agrega query', async () => {
    const { client, fetchMock } = setup(jsonResponse({ items: [], nextCursor: null }));
    await client.listTransactions();
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('http://api.test/transactions');
  });
});

describe('api-client escrituras', () => {
  it('POST /transactions serializa el cuerpo como JSON', async () => {
    const { client, fetchMock } = setup(jsonResponse({ id: 't1' }, 201));
    await client.createTransaction({ type: 'EXPENSE', amount: '5000', date: '2026-03-01', description: 'Café', accountId: 'a1' });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toMatchObject({ type: 'EXPENSE', amount: '5000', accountId: 'a1' });
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(init.cache).toBe('no-store');
  });

  it('DELETE responde 204 sin cuerpo', async () => {
    const { client, fetchMock } = setup(new Response(null, { status: 204 }));
    await expect(client.deleteTransaction('t1')).resolves.toBeUndefined();
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('http://api.test/transactions/t1');
  });

  it('settle envía through y createTransactions: true', async () => {
    const { client, fetchMock } = setup(jsonResponse({ id: 's1' }));
    await client.settleScheduledExpense('s1', '2026-03-10');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.test/scheduled-expenses/s1/settle');
    expect(JSON.parse(init.body as string)).toEqual({ through: '2026-03-10', createTransactions: true });
  });
});

describe('api-client errores tipados', () => {
  it('lanza ApiError con status y mensaje en español de la API', async () => {
    const { client } = setup(jsonResponse({ statusCode: 422, error: 'x', message: 'Saldo insuficiente' }, 422));
    const err = await client.getSummary().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(422);
    expect((err as ApiError).messages).toEqual(['Saldo insuficiente']);
    expect((err as ApiError).message).toBe('Saldo insuficiente');
  });

  it('une varios mensajes de validación', async () => {
    const { client } = setup(jsonResponse({ message: ['A', 'B'] }, 400));
    const err = (await client.getSummary().catch((e: unknown) => e)) as ApiError;
    expect(err.messages).toEqual(['A', 'B']);
  });

  it('cuerpo no JSON produce mensaje genérico', async () => {
    const { client } = setup(new Response('boom', { status: 500 }));
    const err = (await client.getSummary().catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toMatch(/inesperado/i);
  });

  it('error de red -> NetworkError', async () => {
    const { client } = setup(new TypeError('fetch failed'));
    await expect(client.getSummary()).rejects.toBeInstanceOf(NetworkError);
  });
});
