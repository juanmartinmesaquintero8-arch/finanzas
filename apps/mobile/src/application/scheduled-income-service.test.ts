import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openFinanzasDb, type FinanzasDb } from '@/data/database';
import { createServices, type AppServices } from './create-services';
import { INT64_MAX } from './limits';

let dbName = '';
let db: FinanzasDb;
let s: AppServices;
let seq = 0;
let accountId = '';

beforeEach(async () => {
  dbName = `inc-${Math.random()}`;
  db = await openFinanzasDb(dbName);
  seq = 0;
  s = createServices({ db, now: () => new Date('2026-03-10T15:00:00Z'), newId: () => `id-${++seq}` });
  await s.accounts.create({ name: 'Banco', type: 'BANK', initialBalance: '1000000' });
  accountId = (await s.accounts.list())[0]!.id;
});
afterEach(async () => {
  db.close();
  await deleteDB(dbName);
});

const salary = (over = {}) => ({
  description: 'Sueldo',
  amount: '3000000',
  accountId,
  frequency: 'MONTHLY' as const,
  startDate: '2026-01-30',
  category: 'Salario',
  ...over,
});

describe('ingresos programados: crear, editar y borrar', () => {
  it('crea, lista, edita y borra, con su categoría', async () => {
    expect(await s.scheduledIncomes.create(salary())).toEqual({ ok: true });
    const [item] = await s.scheduledIncomes.list();
    expect(item).toMatchObject({ description: 'Sueldo', amount: { amount: '3000000' }, category: 'Salario', endDate: null, settledThrough: null });
    expect(await s.scheduledIncomes.update(item!.id, salary({ description: 'Sueldo nuevo', category: '', endDate: '2026-12-30' }))).toEqual({ ok: true });
    expect((await s.scheduledIncomes.list())[0]).toMatchObject({ description: 'Sueldo nuevo', category: null, endDate: '2026-12-30' });
    expect(await s.scheduledIncomes.remove(item!.id)).toEqual({ ok: true });
    expect(await s.scheduledIncomes.list()).toEqual([]);
  });

  it('no se mezcla con los gastos programados', async () => {
    await s.scheduledIncomes.create(salary());
    expect(await s.scheduled.list()).toEqual([]);
    expect(await db.count('scheduledExpenses')).toBe(0);
    expect(await db.count('scheduledIncomes')).toBe(1);
  });

  it('valida con mensajes del ingreso, cuenta existente y límites de texto y monto', async () => {
    expect(await s.scheduledIncomes.create(salary({ description: '  ' }))).toEqual({ ok: false, error: 'La descripción del ingreso programado es obligatoria' });
    expect(await s.scheduledIncomes.create(salary({ amount: '0' }))).toEqual({ ok: false, error: 'El monto del ingreso programado debe ser mayor que cero' });
    expect(await s.scheduledIncomes.create(salary({ accountId: 'fantasma' }))).toMatchObject({ ok: false });
    expect(await s.scheduledIncomes.create(salary({ endDate: '2025-01-01' }))).toMatchObject({ ok: false });
    expect(await s.scheduledIncomes.create(salary({ description: 'x'.repeat(161) }))).toEqual({ ok: false, error: 'La descripción no puede superar 160 caracteres.' });
    expect(await s.scheduledIncomes.create(salary({ category: 'x'.repeat(61) }))).toEqual({ ok: false, error: 'La categoría no puede superar 60 caracteres.' });
    expect(await s.scheduledIncomes.create(salary({ amount: (INT64_MAX + 1n).toString() }))).toEqual({ ok: false, error: 'El monto es demasiado grande.' });
    expect(await s.scheduledIncomes.update('nope', salary())).toMatchObject({ ok: false });
    expect(await s.scheduledIncomes.remove('nope')).toMatchObject({ ok: false });
    expect(await db.count('scheduledIncomes')).toBe(0);
  });

  it('editar conserva lo ya recibido', async () => {
    await s.scheduledIncomes.create(salary());
    const [item] = await s.scheduledIncomes.list();
    await s.scheduledIncomes.receive(item!.id, '2026-03-10');
    await s.scheduledIncomes.update(item!.id, salary({ description: 'Cambiado' }));
    expect((await s.scheduledIncomes.list())[0]).toMatchObject({ description: 'Cambiado', settledThrough: '2026-03-10' });
  });
});

describe('"Ya lo recibí"', () => {
  it('crea un INCOME real por cada ocurrencia vencida, en su cuenta, con su fecha y su categoría', async () => {
    await s.scheduledIncomes.create(salary()); // 30 ene, 28 feb
    const [item] = await s.scheduledIncomes.list();
    expect(await s.scheduledIncomes.receive(item!.id, '2026-03-10')).toEqual({ ok: true });
    const page = await s.transactions.page({});
    expect(page.items.map((t) => [t.date.slice(0, 10), t.type, t.amount.amount, t.description, t.accountId, t.category])).toEqual([
      ['2026-02-28', 'INCOME', '3000000', 'Sueldo', accountId, 'Salario'],
      ['2026-01-30', 'INCOME', '3000000', 'Sueldo', accountId, 'Salario'],
    ]);
    expect((await s.scheduledIncomes.list())[0]!.settledThrough).toBe('2026-03-10');
    expect((await s.summary.projection('2026-03-31')).netWorth.amount).toBe('7000000');
  });

  it('hace una sola escritura en la base', async () => {
    await s.scheduledIncomes.create(salary());
    const [item] = await s.scheduledIncomes.list();
    const spy = vi.spyOn(db, 'transaction');
    await s.scheduledIncomes.receive(item!.id, '2026-03-10');
    const writes = spy.mock.calls.filter(([, mode]) => mode === 'readwrite');
    expect(writes).toHaveLength(1);
    expect(writes[0]![0]).toEqual(expect.arrayContaining(['transactions', 'scheduledIncomes']));
  });

  it('doble toque seguido: la segunda vez avisa y no duplica', async () => {
    await s.scheduledIncomes.create(salary());
    const [item] = await s.scheduledIncomes.list();
    await s.scheduledIncomes.receive(item!.id, '2026-03-10');
    expect(await s.scheduledIncomes.receive(item!.id, '2026-03-10')).toEqual({ ok: false, error: expect.stringMatching(/ya está registrado/i) });
    expect((await s.transactions.page({})).items).toHaveLength(2);
  });

  it('doble toque a la vez: no duplica movimientos', async () => {
    await s.scheduledIncomes.create(salary());
    const [item] = await s.scheduledIncomes.list();
    await Promise.all([s.scheduledIncomes.receive(item!.id, '2026-03-10'), s.scheduledIncomes.receive(item!.id, '2026-03-10')]);
    expect((await s.transactions.page({})).items).toHaveLength(2);
  });

  it('sin ocurrencias por recibir avisa y no escribe nada', async () => {
    await s.scheduledIncomes.create(salary({ startDate: '2026-03-30' }));
    const [item] = await s.scheduledIncomes.list();
    expect(await s.scheduledIncomes.receive(item!.id, '2026-03-10')).toEqual({ ok: false, error: expect.stringMatching(/todavía/i) });
    expect(await s.scheduledIncomes.receive('nope', '2026-03-10')).toMatchObject({ ok: false });
    expect(await s.transactions.page({})).toEqual({ items: [], nextCursor: null });
    expect((await s.scheduledIncomes.list())[0]!.settledThrough).toBeNull();
  });

  it('un ingreso sin categoría crea el movimiento sin categoría', async () => {
    await s.scheduledIncomes.create(salary({ category: undefined }));
    const [item] = await s.scheduledIncomes.list();
    await s.scheduledIncomes.receive(item!.id, '2026-03-10');
    expect((await s.transactions.page({})).items.every((t) => t.category === null)).toBe(true);
  });
});

describe('cuentas y gastos con ingresos programados', () => {
  it('no deja borrar una cuenta usada por un ingreso programado', async () => {
    await s.scheduledIncomes.create(salary());
    expect(await s.accounts.remove(accountId)).toEqual({
      ok: false,
      error: 'Esta cuenta tiene ingresos programados. Elimínalos primero para poder borrarla.',
    });
    expect(await s.accounts.list()).toHaveLength(1);
  });

  it('un gasto liquidado conserva su categoría y aparece en esa barra de la gráfica', async () => {
    await s.scheduled.create({ description: 'Arriendo', amount: '900000', accountId, frequency: 'MONTHLY', startDate: '2026-03-05', category: 'Vivienda' });
    const [item] = await s.scheduled.list();
    expect(item!.category).toBe('Vivienda');
    expect(await s.scheduled.settle(item!.id, '2026-03-10')).toEqual({ ok: true });
    expect((await s.transactions.page({})).items[0]).toMatchObject({ category: 'Vivienda', type: 'EXPENSE' });
    const view = await s.spending.month('2026-03');
    expect(view.rows.map((r) => [r.label, r.amount])).toEqual([['Vivienda', '900000']]);
  });

  it('un gasto sin categoría sigue liquidándose sin categoría', async () => {
    await s.scheduled.create({ description: 'Arriendo', amount: '900000', accountId, frequency: 'MONTHLY', startDate: '2026-03-05' });
    const [item] = await s.scheduled.list();
    await s.scheduled.settle(item!.id, '2026-03-10');
    expect((await s.transactions.page({})).items[0]!.category).toBeNull();
  });
});

describe('proyección con ingresos programados', () => {
  const base = async () => {
    await s.scheduled.create({ description: 'Arriendo', amount: '500000', accountId, frequency: 'ONCE', startDate: '2026-03-15' });
  };

  it('el Saldo Real queda idéntico con y sin ingresos', async () => {
    await base();
    const without = await s.summary.projection('2026-03-31');
    await s.scheduledIncomes.create(salary({ startDate: '2026-03-30' }));
    const withIncome = await s.summary.projection('2026-03-31');
    const strip = ({ expectedIncome: _a, availableWithIncome: _b, lowestWithIncome: _c, ...rest }: typeof withIncome) => rest;
    expect(strip(withIncome)).toEqual(strip(without));
    expect(withIncome.availableBalance.amount).toBe('500000');
  });

  it('informa lo esperado, el disponible con ingresos y el punto más bajo', async () => {
    await base();
    await s.scheduledIncomes.create(salary({ startDate: '2026-03-30' }));
    const p = await s.summary.projection('2026-03-31');
    expect(p.expectedIncome).toEqual({ amount: '3000000', currency: 'COP' });
    expect(p.availableWithIncome).toEqual({ amount: '3500000', currency: 'COP' });
    expect(p.lowestWithIncome).toEqual({ date: '2026-03-15', balance: { amount: '500000', currency: 'COP' } });
  });

  it('se recalcula al crear un ingreso', async () => {
    expect((await s.summary.projection('2026-03-31')).expectedIncome.amount).toBe('0');
    await s.scheduledIncomes.create(salary({ startDate: '2026-03-20' }));
    expect((await s.summary.projection('2026-03-31')).expectedIncome.amount).toBe('3000000');
  });
});
