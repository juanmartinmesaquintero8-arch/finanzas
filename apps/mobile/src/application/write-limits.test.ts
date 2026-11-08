import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openFinanzasDb, type FinanzasDb } from '@/data/database';
import { createServices, type AppServices } from './create-services';
import { INT64_MAX, INT64_MIN, MAX_TEXT } from './limits';
import { parseMoney } from './support';

let dbName = '';
let db: FinanzasDb;
let s: AppServices;
let seq = 0;

beforeEach(async () => {
  dbName = `wl-${Math.random()}`;
  db = await openFinanzasDb(dbName);
  seq = 0;
  s = createServices({ db, now: () => new Date('2026-03-10T15:00:00Z'), newId: () => `id-${++seq}` });
});
afterEach(async () => {
  db.close();
  await deleteDB(dbName);
});

const BIG = 'El monto es demasiado grande.';
const NAME = 'El nombre no puede superar 80 caracteres.';
const DESC = 'La descripción no puede superar 160 caracteres.';
const CAT = 'La categoría no puede superar 60 caracteres.';

const counts = async () => ({
  accounts: await db.count('accounts'),
  transactions: await db.count('transactions'),
  scheduled: await db.count('scheduledExpenses'),
});

describe('límites compartidos', () => {
  it('INT64 y largos viven en un solo sitio', () => {
    expect(INT64_MAX).toBe(9223372036854775807n);
    expect(INT64_MIN).toBe(-9223372036854775808n);
    expect(MAX_TEXT).toEqual({ id: 100, name: 80, description: 160, category: 60 });
  });
});

describe('monto al guardar', () => {
  it('parseMoney acepta los extremos exactos y rechaza un dígito más', () => {
    expect(parseMoney('9223372036854775807').amount).toBe(INT64_MAX);
    expect(parseMoney('-9223372036854775808').amount).toBe(INT64_MIN);
    expect(() => parseMoney('9223372036854775808')).toThrow(BIG);
    expect(() => parseMoney('-9223372036854775809')).toThrow(BIG);
    expect(() => parseMoney('99999999999999999999')).toThrow(BIG);
  });

  it('cuentas: crear y editar', async () => {
    expect(await s.accounts.create({ name: 'Max', type: 'BANK', initialBalance: '9223372036854775807' })).toEqual({ ok: true });
    expect(await s.accounts.create({ name: 'Min', type: 'BANK', initialBalance: '-9223372036854775808' })).toEqual({ ok: true });
    const before = await counts();
    expect(await s.accounts.create({ name: 'X', type: 'BANK', initialBalance: '9223372036854775808' })).toEqual({ ok: false, error: BIG });
    expect(await counts()).toEqual(before);
    const [a] = await s.accounts.list();
    expect(await s.accounts.update(a!.id, { name: 'Y', type: 'BANK', initialBalance: '9223372036854775808' })).toEqual({ ok: false, error: BIG });
    expect((await s.accounts.list())[0]!.name).toBe(a!.name);
  });

  it('movimientos y programados: crear y editar', async () => {
    await s.accounts.create({ name: 'A', type: 'BANK', initialBalance: '0' });
    const [a] = await s.accounts.list();
    const tx = (amount: string) => ({ type: 'EXPENSE' as const, amount, date: '2026-03-09', description: 'x', accountId: a!.id });
    expect(await s.transactions.create(tx('9223372036854775807'))).toEqual({ ok: true });
    expect(await s.transactions.create(tx('9223372036854775808'))).toEqual({ ok: false, error: BIG });
    const id = (await s.transactions.page({})).items[0]!.id;
    expect(await s.transactions.update(id, tx('9223372036854775808'))).toEqual({ ok: false, error: BIG });
    expect((await s.transactions.get(id))!.amount.amount).toBe('9223372036854775807');
    expect((await counts()).transactions).toBe(1);

    const sc = (amount: string) => ({ description: 'x', amount, accountId: a!.id, frequency: 'MONTHLY' as const, startDate: '2026-04-01' });
    expect(await s.scheduled.create(sc('9223372036854775807'))).toEqual({ ok: true });
    expect(await s.scheduled.create(sc('9223372036854775808'))).toEqual({ ok: false, error: BIG });
    const sid = (await s.scheduled.list())[0]!.id;
    expect(await s.scheduled.update(sid, sc('9223372036854775808'))).toEqual({ ok: false, error: BIG });
    expect((await counts()).scheduled).toBe(1);
  });
});

describe('texto al guardar', () => {
  it('cuentas: nombre de 80 sí, de 81 no (crear y editar)', async () => {
    expect(await s.accounts.create({ name: 'n'.repeat(80), type: 'CASH', initialBalance: '0' })).toEqual({ ok: true });
    const before = await counts();
    expect(await s.accounts.create({ name: 'n'.repeat(81), type: 'CASH', initialBalance: '0' })).toEqual({ ok: false, error: NAME });
    expect(await counts()).toEqual(before);
    const [a] = await s.accounts.list();
    expect(await s.accounts.update(a!.id, { name: 'm'.repeat(81), type: 'CASH', initialBalance: '0' })).toEqual({ ok: false, error: NAME });
    expect((await s.accounts.list())[0]!.name).toBe('n'.repeat(80));
    expect(await s.accounts.update(a!.id, { name: 'm'.repeat(80), type: 'CASH', initialBalance: '0' })).toEqual({ ok: true });
  });

  it('movimientos: descripción 160 / categoría 60 (crear y editar)', async () => {
    await s.accounts.create({ name: 'A', type: 'BANK', initialBalance: '0' });
    const [a] = await s.accounts.list();
    const tx = (over: Record<string, unknown>) => ({ type: 'EXPENSE' as const, amount: '5', date: '2026-03-09', description: 'x', accountId: a!.id, ...over });
    expect(await s.transactions.create(tx({ description: 'd'.repeat(160), category: 'c'.repeat(60) }))).toEqual({ ok: true });
    expect(await s.transactions.create(tx({ description: 'd'.repeat(161) }))).toEqual({ ok: false, error: DESC });
    expect(await s.transactions.create(tx({ category: 'c'.repeat(61) }))).toEqual({ ok: false, error: CAT });
    expect((await counts()).transactions).toBe(1);
    const id = (await s.transactions.page({})).items[0]!.id;
    expect(await s.transactions.update(id, tx({ description: 'd'.repeat(161) }))).toEqual({ ok: false, error: DESC });
    expect(await s.transactions.update(id, tx({ category: 'c'.repeat(61) }))).toEqual({ ok: false, error: CAT });
    expect((await s.transactions.get(id))!.description).toBe('d'.repeat(160));
  });

  it('gastos programados: descripción 160 (crear y editar)', async () => {
    await s.accounts.create({ name: 'A', type: 'BANK', initialBalance: '0' });
    const [a] = await s.accounts.list();
    const sc = (description: string) => ({ description, amount: '5', accountId: a!.id, frequency: 'MONTHLY' as const, startDate: '2026-04-01' });
    expect(await s.scheduled.create(sc('d'.repeat(160)))).toEqual({ ok: true });
    expect(await s.scheduled.create(sc('d'.repeat(161)))).toEqual({ ok: false, error: DESC });
    expect((await counts()).scheduled).toBe(1);
    const id = (await s.scheduled.list())[0]!.id;
    expect(await s.scheduled.update(id, sc('d'.repeat(161)))).toEqual({ ok: false, error: DESC });
    expect((await s.scheduled.list())[0]!.description).toBe('d'.repeat(160));
  });
});
