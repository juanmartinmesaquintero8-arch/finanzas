import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openFinanzasDb, type FinanzasDb } from '@/data/database';
import { createServices, type AppServices } from './create-services';

let dbName = '';
let db: FinanzasDb;
let s: AppServices;
let seq = 0;
let now = new Date('2026-03-10T15:00:00Z');

beforeEach(async () => {
  dbName = `svc-${Math.random()}`;
  db = await openFinanzasDb(dbName);
  seq = 0;
  now = new Date('2026-03-10T15:00:00Z');
  s = createServices({ db, now: () => now, newId: () => `id-${++seq}` });
});
afterEach(async () => {
  db.close();
  await deleteDB(dbName);
});

const newAccount = async (name = 'Banco', balance = '1000000') => {
  const res = await s.accounts.create({ name, type: 'BANK', initialBalance: balance });
  expect(res.ok).toBe(true);
  return (await s.accounts.list()).find((a) => a.name === name)!;
};

const expenseInput = (accountId: string, over = {}) => ({
  type: 'EXPENSE' as const,
  amount: '50000',
  date: '2026-03-09',
  description: 'Almuerzo',
  accountId,
  ...over,
});

describe('cuentas', () => {
  it('crea y lista cuentas con montos como string', async () => {
    const a = await newAccount('Bancolombia', '3000000');
    expect(a).toMatchObject({ name: 'Bancolombia', type: 'BANK', initialBalance: { amount: '3000000', currency: 'COP' } });
  });

  it('rechaza un nombre vacío con un mensaje en español', async () => {
    const res = await s.accounts.create({ name: '   ', type: 'CASH', initialBalance: '0' });
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/nombre/i) });
    expect(await s.accounts.list()).toEqual([]);
  });

  it('edita nombre, tipo y saldo inicial', async () => {
    const a = await newAccount();
    expect(await s.accounts.update(a.id, { name: 'Nu', type: 'DIGITAL', initialBalance: '5' })).toEqual({ ok: true });
    expect((await s.accounts.list())[0]).toMatchObject({ name: 'Nu', type: 'DIGITAL', initialBalance: { amount: '5' } });
  });

  it('editar una cuenta que no existe devuelve error', async () => {
    expect(await s.accounts.update('nope', { name: 'x', type: 'CASH', initialBalance: '0' })).toMatchObject({ ok: false });
  });

  it('no deja borrar una cuenta con movimientos ni con gastos programados', async () => {
    const a = await newAccount();
    await s.transactions.create(expenseInput(a.id));
    expect(await s.accounts.remove(a.id)).toEqual({ ok: false, error: expect.stringMatching(/movimientos/i) });
    const b = await newAccount('Otra');
    await s.scheduled.create({ description: 'Arriendo', amount: '1', accountId: b.id, frequency: 'MONTHLY', startDate: '2026-04-01' });
    expect(await s.accounts.remove(b.id)).toEqual({ ok: false, error: expect.stringMatching(/programados/i) });
  });

  it('borra una cuenta vacía', async () => {
    const a = await newAccount();
    expect(await s.accounts.remove(a.id)).toEqual({ ok: true });
    expect(await s.accounts.list()).toEqual([]);
  });
});

describe('movimientos', () => {
  it('crea ingreso, gasto y transferencia y los lee por id', async () => {
    const a = await newAccount('A');
    const b = await newAccount('B');
    expect(await s.transactions.create({ type: 'INCOME', amount: '100', date: '2026-03-01', description: 'Sueldo', accountId: a.id })).toEqual({ ok: true });
    expect(await s.transactions.create({ type: 'TRANSFER', amount: '10', date: '2026-03-02', description: 'Pasar', fromAccountId: a.id, toAccountId: b.id })).toEqual({ ok: true });
    const page = await s.transactions.page({});
    expect(page.items.map((t) => t.type)).toEqual(['TRANSFER', 'INCOME']);
    const one = await s.transactions.get(page.items[0]!.id);
    expect(one).toMatchObject({ type: 'TRANSFER', fromAccountId: a.id, toAccountId: b.id, amount: { amount: '10' } });
    expect(await s.transactions.get('nope')).toBeNull();
  });

  it('valida: monto, cuenta inexistente y transferencia sin destino', async () => {
    const a = await newAccount();
    expect(await s.transactions.create(expenseInput(a.id, { amount: 'abc' }))).toMatchObject({ ok: false });
    expect(await s.transactions.create(expenseInput(a.id, { amount: '0' }))).toMatchObject({ ok: false, error: expect.stringMatching(/mayor/i) });
    expect(await s.transactions.create(expenseInput('fantasma'))).toMatchObject({ ok: false, error: expect.stringMatching(/cuenta/i) });
    expect(await s.transactions.create({ type: 'TRANSFER', amount: '5', date: '2026-03-01', description: 'x', fromAccountId: a.id })).toMatchObject({ ok: false });
    expect((await s.transactions.page({})).items).toEqual([]);
  });

  it('editar reemplaza el movimiento (incluso cambiando de tipo) y conserva el id', async () => {
    const a = await newAccount('A');
    const b = await newAccount('B');
    await s.transactions.create(expenseInput(a.id));
    const id = (await s.transactions.page({})).items[0]!.id;
    expect(await s.transactions.update(id, { type: 'TRANSFER', amount: '7', date: '2026-03-09', description: 'ahora transferencia', fromAccountId: a.id, toAccountId: b.id })).toEqual({ ok: true });
    const page = await s.transactions.page({});
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id, type: 'TRANSFER', amount: { amount: '7' } });
    expect(await s.transactions.update('nope', expenseInput(a.id))).toMatchObject({ ok: false });
  });

  it('elimina un movimiento', async () => {
    const a = await newAccount();
    await s.transactions.create(expenseInput(a.id));
    const id = (await s.transactions.page({})).items[0]!.id;
    expect(await s.transactions.remove(id)).toEqual({ ok: true });
    expect((await s.transactions.page({})).items).toEqual([]);
    expect(await s.transactions.remove(id)).toMatchObject({ ok: false });
  });

  it('pagina por cursor opaco sin repetir, y filtra por cuenta', async () => {
    const a = await newAccount('A');
    const b = await newAccount('B');
    for (let d = 1; d <= 5; d++) await s.transactions.create(expenseInput(d % 2 ? a.id : b.id, { date: `2026-03-0${d}`, description: `m${d}` }));
    const first = await s.transactions.page({ limit: 2 });
    expect(first.items.map((t) => t.description)).toEqual(['m5', 'm4']);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await s.transactions.page({ limit: 2, cursor: first.nextCursor! });
    expect(second.items.map((t) => t.description)).toEqual(['m3', 'm2']);
    const third = await s.transactions.page({ limit: 2, cursor: second.nextCursor! });
    expect(third.items.map((t) => t.description)).toEqual(['m1']);
    expect(third.nextCursor).toBeNull();
    expect((await s.transactions.page({ accountId: a.id })).items.map((t) => t.description)).toEqual(['m5', 'm3', 'm1']);
  });

  it('un cursor inválido da error claro', async () => {
    await expect(s.transactions.page({ cursor: '%%%' })).rejects.toThrow(/cursor/i);
  });
});

describe('resumen y proyección', () => {
  it('Saldo Real Disponible = patrimonio - compromisos pendientes hasta el corte', async () => {
    const a = await newAccount('A', '1000000');
    const b = await newAccount('B', '500000');
    await s.transactions.create({ type: 'INCOME', amount: '200000', date: '2026-03-05', description: 'Sueldo', accountId: a.id });
    await s.transactions.create(expenseInput(b.id, { amount: '100000' }));
    await s.scheduled.create({ description: 'Arriendo', amount: '300000', accountId: a.id, frequency: 'MONTHLY', startDate: '2026-03-15' });

    const p = await s.summary.projection('2026-04-30');
    expect(p.netWorth.amount).toBe('1600000'); // 1.5M + 200k - 100k
    expect(p.committed.amount).toBe('600000'); // 15 mar y 15 abr
    expect(p.availableBalance.amount).toBe('1000000');
    expect(p.isShortfall).toBe(false);
    expect(p.commitments.map((c) => c.date)).toEqual(['2026-03-15', '2026-04-15']);
    const accA = p.accounts.find((x) => x.accountId === a.id)!;
    expect(accA).toMatchObject({ name: 'A', balance: { amount: '1200000' }, committed: { amount: '600000' }, available: { amount: '600000' } });
  });

  it('marca déficit cuando los compromisos superan el patrimonio', async () => {
    const a = await newAccount('A', '100');
    await s.scheduled.create({ description: 'Deuda', amount: '500', accountId: a.id, frequency: 'ONCE', startDate: '2026-03-20' });
    const p = await s.summary.projection('2026-03-31');
    expect(p.isShortfall).toBe(true);
    expect(p.availableBalance.amount).toBe('-400');
  });

  it('el horizonte recorta los compromisos y nunca mira antes de hoy', async () => {
    const a = await newAccount('A', '1000');
    await s.scheduled.create({ description: 'Pasado', amount: '10', accountId: a.id, frequency: 'ONCE', startDate: '2026-03-01' });
    await s.scheduled.create({ description: 'Lejos', amount: '20', accountId: a.id, frequency: 'ONCE', startDate: '2026-09-01' });
    const p = await s.summary.projection('2026-03-31');
    expect(p.committed.amount).toBe('0');
    expect((await s.summary.projection('2020-01-01')).to).toBe('2026-03-10');
  });

  it('memoiza por versión de datos y se invalida tras cualquier escritura', async () => {
    const a = await newAccount('A', '1000');
    const spy = vi.spyOn(db, 'transaction');
    const first = await s.summary.projection('2026-03-31');
    const callsAfterFirst = spy.mock.calls.length;
    const again = await s.summary.projection('2026-03-31');
    expect(again).toBe(first); // mismo objeto: no recalculó
    expect(spy.mock.calls.length).toBe(callsAfterFirst);

    await s.transactions.create(expenseInput(a.id, { amount: '300' }));
    const fresh = await s.summary.projection('2026-03-31');
    expect(fresh).not.toBe(first);
    expect(fresh.netWorth.amount).toBe('700');
  });

  it('otro horizonte reutiliza los saldos ya calculados', async () => {
    await newAccount('A', '1000');
    await s.summary.projection('2026-03-31');
    const spy = vi.spyOn(db, 'transaction');
    await s.summary.projection('2026-06-10');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('gastos programados', () => {
  const rent = (accountId: string, over = {}) => ({
    description: 'Arriendo',
    amount: '900000',
    accountId,
    frequency: 'MONTHLY' as const,
    startDate: '2026-01-05',
    ...over,
  });

  it('crea, lista, edita y borra', async () => {
    const a = await newAccount();
    expect(await s.scheduled.create(rent(a.id))).toEqual({ ok: true });
    const [item] = await s.scheduled.list();
    expect(item).toMatchObject({ description: 'Arriendo', frequency: 'MONTHLY', startDate: '2026-01-05', endDate: null, settledThrough: null, amount: { amount: '900000' } });
    expect(await s.scheduled.update(item!.id, rent(a.id, { description: 'Arriendo nuevo', endDate: '2026-12-05' }))).toEqual({ ok: true });
    expect((await s.scheduled.list())[0]).toMatchObject({ description: 'Arriendo nuevo', endDate: '2026-12-05' });
    expect(await s.scheduled.remove(item!.id)).toEqual({ ok: true });
    expect(await s.scheduled.list()).toEqual([]);
  });

  it('valida cuenta, fechas y monto', async () => {
    const a = await newAccount();
    expect(await s.scheduled.create(rent('fantasma'))).toMatchObject({ ok: false });
    expect(await s.scheduled.create(rent(a.id, { endDate: '2025-01-01' }))).toMatchObject({ ok: false });
    expect(await s.scheduled.create(rent(a.id, { amount: '0' }))).toMatchObject({ ok: false });
    expect(await s.scheduled.update('nope', rent(a.id))).toMatchObject({ ok: false });
  });

  it('editar conserva lo que ya estaba liquidado', async () => {
    const a = await newAccount();
    await s.scheduled.create(rent(a.id));
    const [item] = await s.scheduled.list();
    await s.scheduled.settle(item!.id, '2026-03-10');
    await s.scheduled.update(item!.id, rent(a.id, { description: 'Cambiado' }));
    expect((await s.scheduled.list())[0]).toMatchObject({ description: 'Cambiado', settledThrough: '2026-03-10' });
  });

  it('"Ya lo pagué" crea un gasto real por cada ocurrencia vencida y marca liquidado', async () => {
    const a = await newAccount('A', '5000000');
    await s.scheduled.create(rent(a.id)); // 5 ene, 5 feb, 5 mar
    const [item] = await s.scheduled.list();
    expect(await s.scheduled.settle(item!.id, '2026-03-10')).toEqual({ ok: true });

    const page = await s.transactions.page({});
    expect(page.items.map((t) => [t.date.slice(0, 10), t.type, t.amount.amount, t.description, t.accountId])).toEqual([
      ['2026-03-05', 'EXPENSE', '900000', 'Arriendo', a.id],
      ['2026-02-05', 'EXPENSE', '900000', 'Arriendo', a.id],
      ['2026-01-05', 'EXPENSE', '900000', 'Arriendo', a.id],
    ]);
    expect((await s.scheduled.list())[0]!.settledThrough).toBe('2026-03-10');
    // El patrimonio baja por los gastos reales y ya no se cuentan como compromiso.
    const p = await s.summary.projection('2026-03-31');
    expect(p.netWorth.amount).toBe('2300000');
    expect(p.committed.amount).toBe('0');
  });

  it('no permite liquidar dos veces hasta la misma fecha', async () => {
    const a = await newAccount();
    await s.scheduled.create(rent(a.id));
    const [item] = await s.scheduled.list();
    await s.scheduled.settle(item!.id, '2026-03-10');
    expect(await s.scheduled.settle(item!.id, '2026-03-10')).toEqual({ ok: false, error: expect.stringMatching(/liquidado/i) });
    expect(await s.scheduled.settle('nope', '2026-03-10')).toMatchObject({ ok: false });
    expect((await s.transactions.page({})).items).toHaveLength(3);
  });
});

describe('observador de cambios', () => {
  it('avisa tras cada escritura exitosa y no cuando falla', async () => {
    const listener = vi.fn();
    s.bus.subscribe(listener);
    const a = await newAccount();
    expect(listener).toHaveBeenCalledTimes(1);
    await s.transactions.create(expenseInput(a.id));
    expect(listener).toHaveBeenCalledTimes(2);
    await s.transactions.create(expenseInput('fantasma'));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('se puede cancelar la suscripción', async () => {
    const listener = vi.fn();
    const off = s.bus.subscribe(listener);
    off();
    await newAccount();
    expect(listener).not.toHaveBeenCalled();
  });
});
