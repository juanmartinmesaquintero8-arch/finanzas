import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openFinanzasDb, type FinanzasDb, type StoredTransaction } from '@/data/database';
import { createServices, type AppServices } from './create-services';

let dbName = '';
let db: FinanzasDb;
let s: AppServices;
let seq = 0;
let now = new Date('2026-03-10T15:00:00Z');
let accountId = '';

const make = () => createServices({ db, now: () => now, newId: () => `id-${++seq}` });

beforeEach(async () => {
  dbName = `spend-${Math.random()}`;
  db = await openFinanzasDb(dbName);
  seq = 0;
  now = new Date('2026-03-10T15:00:00Z');
  s = make();
  await s.accounts.create({ name: 'Banco', type: 'BANK', initialBalance: '0' });
  accountId = (await s.accounts.list())[0]!.id;
});
afterEach(async () => {
  db.close();
  await deleteDB(dbName);
});

const spend = async (date: string, amount: string, category?: string, type: 'EXPENSE' | 'INCOME' = 'EXPENSE') => {
  const res = await s.transactions.create({ type, amount, date, description: 'x', category, accountId });
  expect(res).toEqual({ ok: true });
};

describe('SpendingService', () => {
  it('suma solo gastos del mes y los agrupa por categoría (sin ingresos ni traspasos)', async () => {
    await spend('2026-02-03', '100000', 'Mercado');
    await spend('2026-02-20', '50000', 'mercado ');
    await spend('2026-02-21', '30000', 'Educación');
    await spend('2026-02-22', '999999', 'Sueldo', 'INCOME');
    await s.accounts.create({ name: 'Nu', type: 'DIGITAL', initialBalance: '0' });
    const nu = (await s.accounts.list()).find((a) => a.name === 'Nu')!.id;
    await s.transactions.create({ type: 'TRANSFER', amount: '77777', date: '2026-02-10', description: 't', fromAccountId: accountId, toAccountId: nu });

    const view = await s.spending.month('2026-02');
    expect(view.total).toBe('180000');
    expect(view.rows.map((r) => [r.label, r.amount])).toEqual([
      ['Mercado', '150000'],
      ['Educación', '30000'],
    ]);
  });

  it('mes cerrado: se compara con el mes anterior completo', async () => {
    await spend('2026-01-05', '10000', 'Mercado');
    await spend('2026-01-31', '20000', 'Mercado');
    await spend('2026-02-05', '50000', 'Mercado');
    const view = await s.spending.month('2026-02');
    expect(view).toMatchObject({ month: '2026-02', previousMonth: '2026-01', isCurrent: false, comparedUntilDay: null, previousTotal: '30000' });
    expect(view.rows[0]).toMatchObject({ delta: '20000', isNew: false });
  });

  it('mes en curso: se compara con los mismos días del mes anterior (hoy 10: del 1 al 10)', async () => {
    await spend('2026-02-05', '10000', 'Mercado');
    await spend('2026-02-10', '5000', 'Mercado');
    await spend('2026-02-11', '900000', 'Mercado'); // después del día 10: no cuenta
    await spend('2026-03-09', '40000', 'Mercado');
    const view = await s.spending.month('2026-03');
    expect(view).toMatchObject({ isCurrent: true, comparedUntilDay: 10, previousMonth: '2026-02', previousTotal: '15000', total: '40000' });
    expect(view.rows[0]).toMatchObject({ delta: '25000' });
  });

  it('31 de marzo contra febrero: usa todo febrero (28 días)', async () => {
    now = new Date('2026-03-31T15:00:00Z');
    s = make();
    await spend('2026-02-28', '7000', 'Mercado');
    await spend('2026-03-31', '9000', 'Mercado');
    const view = await s.spending.month('2026-03');
    expect(view).toMatchObject({ comparedUntilDay: 31, previousTotal: '7000' });
  });

  it('usa la fecha de Colombia: a las 21:00 del 31 aún es 31, aunque en UTC ya sea 1 de abril', async () => {
    now = new Date('2026-04-01T02:00:00Z');
    s = make();
    const view = await s.spending.month('2026-03');
    expect(view).toMatchObject({ month: '2026-03', isCurrent: true, comparedUntilDay: 31 });
  });

  it('una categoría sin gasto el mes anterior es nueva; sin gasto previo alguno no hay comparación', async () => {
    await spend('2026-02-05', '10000', 'Mercado');
    await spend('2026-03-02', '1000', 'Mercado');
    await spend('2026-03-02', '2000', 'Ocio');
    const view = await s.spending.month('2026-03');
    expect(view.rows.find((r) => r.label === 'Ocio')).toMatchObject({ isNew: true, delta: '2000' });

    await spend('2026-03-03', '5', 'Mercado');
    const sinHistoria = await s.spending.month('2026-02');
    expect(sinHistoria).toMatchObject({ previousTotal: null });
    expect(sinHistoria.rows[0]).toMatchObject({ delta: null, isNew: false });
  });

  it('montos mayores que Number.MAX_SAFE_INTEGER no pierden precisión', async () => {
    await spend('2026-02-05', '9007199254740993', 'Casa');
    await spend('2026-02-06', '9007199254740993', 'Casa');
    expect((await s.spending.month('2026-02')).total).toBe('18014398509481986');
  });

  it('limita la consulta a 24 meses y reconoce hasta dónde se puede navegar', async () => {
    const view = await s.spending.month('2020-01');
    expect(view).toMatchObject({ month: '2024-04', oldestMonth: '2024-04', currentMonth: '2026-03' });
    expect((await s.spending.month('2030-01')).month).toBe('2026-03');
    expect((await s.spending.month('no-es-un-mes')).month).toBe('2026-03');
  });

  it('memoriza por versión de datos: repite el resultado y se renueva al escribir', async () => {
    await spend('2026-03-02', '1000', 'Mercado');
    const a = s.spending.month('2026-03');
    expect(s.spending.month('2026-03')).toBe(a);
    await spend('2026-03-03', '500', 'Mercado');
    expect((await s.spending.month('2026-03')).total).toBe('1500');
  });

  it('lee por lotes aunque haya más de 5.000 filas en el mismo instante', async () => {
    const tx = db.transaction('transactions', 'readwrite');
    const date = '2026-02-15T00:00:00.000Z';
    for (let i = 0; i < 11_000; i++) {
      const row: StoredTransaction = {
        id: `bulk-${i}`,
        type: 'EXPENSE',
        amount: '10',
        currency: 'COP',
        date,
        description: 'x',
        category: i % 2 ? 'Par' : 'Impar',
        accountId,
        fromAccountId: null,
        toAccountId: null,
        accountDates: [],
      };
      void tx.store.put(row);
    }
    await tx.done;
    const view = await s.spending.month('2026-02');
    expect(view.total).toBe('110000');
    expect(view.rows.map((r) => r.amount)).toEqual(['55000', '55000']);
  });

  it('sin gastos devuelve el mes vacío', async () => {
    expect(await s.spending.month('2026-03')).toMatchObject({ total: '0', rows: [], previousTotal: null });
  });
});

describe('Historial filtrado por mes y categoría', () => {
  it('muestra solo los gastos de esa categoría y ese mes, y pagina con el cursor', async () => {
    for (let d = 1; d <= 5; d++) await spend(`2026-02-0${d}`, '1000', 'Mercado');
    await spend('2026-02-06', '1000', 'Ocio');
    await spend('2026-01-30', '1000', 'Mercado');
    await spend('2026-03-01', '1000', 'Mercado');
    await spend('2026-02-07', '1000', 'Mercado', 'INCOME');

    const first = await s.transactions.page({ month: '2026-02', category: 'mercado', limit: 3 });
    expect(first.items.map((t) => t.date.slice(0, 10))).toEqual(['2026-02-05', '2026-02-04', '2026-02-03']);
    expect(first.nextCursor).not.toBeNull();
    const second = await s.transactions.page({ month: '2026-02', category: 'mercado', limit: 3, cursor: first.nextCursor! });
    expect(second.items.map((t) => t.date.slice(0, 10))).toEqual(['2026-02-02', '2026-02-01']);
    expect(second.nextCursor).toBeNull();
  });

  it('"sin-categoria" trae los gastos sin categoría; solo el mes trae todo el mes', async () => {
    await spend('2026-02-01', '1000');
    await spend('2026-02-02', '1000', '  ');
    await spend('2026-02-03', '1000', 'Ocio');
    expect((await s.transactions.page({ month: '2026-02', category: 'sin-categoria' })).items).toHaveLength(2);
    expect((await s.transactions.page({ month: '2026-02' })).items).toHaveLength(3);
  });

  it('la categoría coincide aunque cambien tildes o mayúsculas', async () => {
    await spend('2026-02-01', '1000', 'Educación');
    await spend('2026-02-02', '1000', 'EDUCACION');
    expect((await s.transactions.page({ month: '2026-02', category: 'educacion' })).items).toHaveLength(2);
  });
});
