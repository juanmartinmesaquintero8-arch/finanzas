import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openFinanzasDb, type FinanzasDb } from '@/data/database';
import { BACKUP_VERSION, MAX_ITEMS, parseBackup } from './backup';
import { createServices, type AppServices } from './create-services';

let dbName = '';
let db: FinanzasDb;
let s: AppServices;
let seq = 0;
const NOW = new Date('2026-03-10T15:00:00Z');

beforeEach(async () => {
  dbName = `bk2-${Math.random()}`;
  db = await openFinanzasDb(dbName);
  seq = 0;
  s = createServices({ db, now: () => NOW, newId: () => `id-${++seq}` });
});
afterEach(async () => {
  db.close();
  await deleteDB(dbName);
});

const NEWER = 'Esta copia fue hecha con una versión más nueva de la app. Actualiza la app e inténtalo de nuevo.';
const DAMAGED = 'La copia de seguridad está dañada o incompleta, así que no se puede usar.';
const TOO_MANY = 'La copia tiene más datos de los que la app puede manejar, así que no se puede usar.';
const prefix = 'La copia no se puede usar: ';
const cop = (n: string) => ({ amount: n, currency: 'COP' });
const acc = { id: 'a1', name: 'Cuenta', type: 'BANK', initialBalance: cop('0') };
const inc = (over: Record<string, unknown> = {}) => ({
  id: 'i1',
  description: 'Sueldo',
  amount: cop('5'),
  accountId: 'a1',
  frequency: 'MONTHLY',
  startDate: '2026-04-30',
  endDate: null,
  settledThrough: null,
  category: 'Salario',
  ...over,
});
const v2 = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ version: 2, exportedAt: NOW.toISOString(), accounts: [acc], transactions: [], scheduledExpenses: [], scheduledIncomes: [inc()], ...over });
const err = (text: string) => {
  const r = parseBackup(text);
  return r.ok ? 'OK' : r.error;
};

async function seedBasics(svc: AppServices) {
  await svc.accounts.create({ name: 'Bancolombia', type: 'BANK', initialBalance: '3000000' });
  const [a] = await svc.accounts.list();
  await svc.scheduled.create({ description: 'Arriendo', amount: '1200000', accountId: a!.id, frequency: 'MONTHLY', startDate: '2026-04-05', category: 'Vivienda' });
  return a!;
}

describe('copia v2: ingresos programados', () => {
  it('la versión del formato es 3 y el tope de ingresos es 2.000', () => {
    expect(BACKUP_VERSION).toBe(4);
    expect(MAX_ITEMS.scheduledIncomes).toBe(2000);
  });

  it('ida y vuelta: exporta e importa los ingresos con su categoría y lo ya recibido', async () => {
    const a = await seedBasics(s);
    await s.scheduledIncomes.create({ description: 'Sueldo', amount: '3000000', accountId: a.id, frequency: 'MONTHLY', startDate: '2026-02-28', endDate: '2026-12-28', category: 'Salario' });
    const [item] = await s.scheduledIncomes.list();
    await s.scheduledIncomes.receive(item!.id, '2026-03-10');
    const { text, problem } = await s.backup.create();
    expect(problem).toBeNull();
    const file = JSON.parse(text);
    expect(file.version).toBe(BACKUP_VERSION);
    expect(file.scheduledIncomes).toHaveLength(1);

    const otherName = `bk2-otro-${Math.random()}`;
    const otherDb = await openFinanzasDb(otherName);
    try {
      const other = createServices({ db: otherDb, now: () => NOW, newId: () => `o-${++seq}` });
      const parsed = parseBackup(text);
      if (!parsed.ok) throw new Error(parsed.error);
      expect(parsed.summary).toMatchObject({ scheduledIncomes: 1 });
      expect(await other.backup.restore(parsed.snapshot)).toEqual({ ok: true });
      expect(await other.scheduledIncomes.list()).toEqual(await s.scheduledIncomes.list());
      expect((await other.scheduledIncomes.list())[0]).toMatchObject({ category: 'Salario', settledThrough: '2026-02-28', endDate: '2026-12-28' });
      expect(await other.scheduled.list()).toEqual(await s.scheduled.list());
      expect((await other.scheduled.list())[0]!.category).toBe('Vivienda');
    } finally {
      otherDb.close();
      await deleteDB(otherName);
    }
  });

  it('recuperar reemplaza TODO, también los ingresos que ya había', async () => {
    const a = await seedBasics(s);
    await s.scheduledIncomes.create({ description: 'Viejo', amount: '1', accountId: a.id, frequency: 'ONCE', startDate: '2026-05-01' });
    const parsed = parseBackup(v2());
    if (!parsed.ok) throw new Error(parsed.error);
    await s.backup.restore(parsed.snapshot);
    expect((await s.scheduledIncomes.list()).map((i) => i.description)).toEqual(['Sueldo']);
  });

  it('una copia v1 literal, sin scheduledIncomes ni category, se recupera y deja los ingresos vacíos', async () => {
    const text =
      '{"version":1,"exportedAt":"2026-03-10T15:00:00.000Z","accounts":[{"id":"a1","name":"Nu","type":"DIGITAL","initialBalance":{"amount":"100","currency":"COP"}}],"transactions":[],"scheduledExpenses":[{"id":"s1","description":"Arriendo","amount":{"amount":"5","currency":"COP"},"accountId":"a1","frequency":"MONTHLY","startDate":"2026-04-01","endDate":null,"settledThrough":null}]}';
    const parsed = parseBackup(text);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.summary).toMatchObject({ accounts: 1, scheduledExpenses: 1, scheduledIncomes: 0 });
    expect(parsed.snapshot.scheduledIncomes).toEqual([]);
    expect(parsed.snapshot.scheduledExpenses[0]!.category).toBeUndefined();
    await s.accounts.create({ name: 'Previa', type: 'CASH', initialBalance: '0' });
    expect(await s.backup.restore(parsed.snapshot)).toEqual({ ok: true });
    expect((await s.accounts.list()).map((a) => a.name)).toEqual(['Nu']);
    expect(await s.scheduledIncomes.list()).toEqual([]);
  });

  it('en v2 la lista de ingresos es obligatoria', () => {
    const { scheduledIncomes: _omit, ...without } = JSON.parse(v2());
    expect(err(JSON.stringify(without))).toBe(DAMAGED);
    expect(err(v2({ scheduledIncomes: 'x' }))).toMatch(/copia de seguridad/i);
  });

  it('un archivo más nuevo sigue dando el aviso', () => {
    expect(err(v2({ version: BACKUP_VERSION + 1 }))).toBe(NEWER);
  });

  it('category es opcional en gastos e ingresos y se conserva', () => {
    const exp = { id: 's1', description: 'Arriendo', amount: cop('5'), accountId: 'a1', frequency: 'MONTHLY', startDate: '2026-04-01', endDate: null, settledThrough: null };
    const parsed = parseBackup(v2({ scheduledExpenses: [{ ...exp, category: 'Vivienda' }], scheduledIncomes: [inc({ category: undefined })] }));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.snapshot.scheduledExpenses[0]!.category).toBe('Vivienda');
    expect(parsed.snapshot.scheduledIncomes[0]!.category).toBeUndefined();
    expect(err(v2({ scheduledExpenses: [{ ...exp, category: 'c'.repeat(2001) }] }))).toBe(
      `${prefix}el gasto programado «Arriendo» tiene un texto demasiado largo (máximo 2.000 caracteres).`,
    );
    expect(err(v2({ scheduledIncomes: [inc({ category: 7 })] }))).toBe(DAMAGED);
  });

  it('datos inválidos nombran el ingreso programado', () => {
    const long = (x: string) => `${prefix}${x} tiene un texto demasiado largo (máximo 2.000 caracteres).`;
    const big = (x: string) => `${prefix}${x} tiene un monto demasiado grande.`;
    expect(err(v2({ scheduledIncomes: [inc({ description: 'g'.repeat(2001) })] }))).toBe(long(`el ingreso programado «${'g'.repeat(40)}…»`));
    expect(err(v2({ scheduledIncomes: [inc({ amount: cop('9223372036854775808') })] }))).toBe(big('el ingreso programado «Sueldo»'));
    expect(err(v2({ scheduledIncomes: [inc({ description: null, amount: cop('9223372036854775808') })] }))).toBe(big('un ingreso programado'));
    expect(err(v2({ scheduledIncomes: [inc({ description: 'g'.repeat(2000) })] }))).toBe('OK');
    expect(err(v2({ scheduledIncomes: [inc({ amount: cop('9223372036854775807') })] }))).toBe('OK');
  });

  it('rechaza ids, frecuencias y fechas dañados, y montos no positivos', () => {
    const bads = [{ id: '<x>' }, { accountId: '' }, { frequency: 'DIARIO' }, { startDate: 'ayer' }, { endDate: 'mañana' }, { settledThrough: 'x' }, { amount: cop('0') }, { description: '   ' }, { endDate: '2026-01-01' }];
    for (const bad of bads) expect(err(v2({ scheduledIncomes: [inc(bad)] }))).toBe(DAMAGED);
  });

  it('exige ids únicos y una cuenta que exista en la copia', () => {
    expect(err(v2({ scheduledIncomes: [inc(), inc()] }))).toMatch(/repetidos/i);
    expect(err(v2({ scheduledIncomes: [inc({ accountId: 'fantasma' })] }))).toMatch(/cuenta que no existe/i);
  });

  it('respeta el tope de ingresos programados', () => {
    expect(err(v2({ scheduledIncomes: Array.from({ length: MAX_ITEMS.scheduledIncomes + 1 }, () => ({})) }))).toBe(TOO_MANY);
  });
});
