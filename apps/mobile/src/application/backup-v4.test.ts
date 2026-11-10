import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openFinanzasDb, type FinanzasDb } from '@/data/database';
import { BACKUP_VERSION, parseBackup, serializeBackup } from './backup';
import { createServices, type AppServices } from './create-services';
import { generateSampleData } from './sample-data';

let dbName = '';
let db: FinanzasDb;
let s: AppServices;
let seq = 0;
const NOW = new Date('2026-03-10T15:00:00Z');

beforeEach(async () => {
  dbName = `bk4-${Math.random()}`;
  db = await openFinanzasDb(dbName);
  seq = 0;
  s = createServices({ db, now: () => NOW, newId: () => `id-${++seq}` });
});
afterEach(async () => {
  db.close();
  await deleteDB(dbName);
});

const NEWER = 'Esta copia fue hecha con una versión más nueva de la app. Actualiza la app e inténtalo de nuevo.';
const prefix = 'La copia no se puede usar: ';
const cop = (n: string) => ({ amount: n, currency: 'COP' });
const acc = { id: 'a1', name: 'Cuenta', type: 'BANK', initialBalance: cop('0') };
const card = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  name: 'Visa',
  dueDay: 15,
  paymentAccountId: 'a1',
  fee: { kind: 'FIXED_MONTHLY', amount: cop('18000') },
  rate: { basis: 'MV', ppm: 20000 },
  feeStartMonth: '2026-03',
  feesSettledThrough: null,
  ...over,
});
const file = (version: number, over: Record<string, unknown> = {}) =>
  JSON.stringify({ version, exportedAt: NOW.toISOString(), accounts: [acc], transactions: [], scheduledExpenses: [], scheduledIncomes: [], creditCards: [card()], cardPurchases: [], ...over });
const err = (text: string) => {
  const r = parseBackup(text);
  return r.ok ? 'OK' : r.error;
};

describe('copia v4: día de corte', () => {
  it('la versión es 4', () => {
    expect(BACKUP_VERSION).toBe(4);
  });

  it('ida y vuelta con y sin corte', async () => {
    await s.accounts.create({ name: 'Banco', type: 'BANK', initialBalance: '3000000' });
    const [a] = await s.accounts.list();
    await s.cards.createCard({ name: 'Con corte', dueDay: 25, cutDay: 10, paymentAccountId: a!.id, feeKind: 'NONE' });
    await s.cards.createCard({ name: 'Sin corte', dueDay: 15, paymentAccountId: a!.id, feeKind: 'NONE' });
    const { text, problem } = await s.backup.create();
    expect(problem).toBeNull();
    const saved = JSON.parse(text);
    expect(saved.version).toBe(4);
    expect(saved.creditCards.map((c: { name: string; cutDay: number | null }) => [c.name, c.cutDay]).sort()).toEqual([
      ['Con corte', 10],
      ['Sin corte', null],
    ]);

    const otherName = `bk4-otro-${Math.random()}`;
    const otherDb = await openFinanzasDb(otherName);
    try {
      const other = createServices({ db: otherDb, now: () => NOW, newId: () => `o-${++seq}` });
      const parsed = parseBackup(text);
      if (!parsed.ok) throw new Error(parsed.error);
      expect(await other.backup.restore(parsed.snapshot)).toEqual({ ok: true });
      expect(await other.cards.list()).toEqual(await s.cards.list());
      const byName = Object.fromEntries((await other.cards.list()).map((c) => [c.name, c.cutDay]));
      expect(byName).toEqual({ 'Con corte': 10, 'Sin corte': null });
    } finally {
      otherDb.close();
      await deleteDB(otherName);
    }
  });

  it('los datos de ejemplo (con corte) producen una copia válida que conserva el corte', () => {
    const parsed = parseBackup(serializeBackup(generateSampleData(NOW), NOW));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.snapshot.creditCards[0]!.cutDay).toBe(5);
  });

  it('cutDay es opcional: ausente o null se aceptan', () => {
    expect(err(file(4))).toBe('OK');
    expect(err(file(4, { creditCards: [card({ cutDay: null })] }))).toBe('OK');
    expect(err(file(4, { creditCards: [card({ cutDay: 5 })] }))).toBe('OK');
  });

  it('un corte inválido o igual al día de pago deja la copia inutilizable con mensaje concreto', () => {
    const bad = `${prefix}la tarjeta «Visa» tiene datos que no son válidos.`;
    expect(err(file(4, { creditCards: [card({ cutDay: 0 })] }))).toBe(bad);
    expect(err(file(4, { creditCards: [card({ cutDay: 32 })] }))).toBe(bad);
    expect(err(file(4, { creditCards: [card({ cutDay: 15 })] }))).toBe(bad);
    expect(err(file(4, { creditCards: [card({ cutDay: 'cinco' })] }))).toBe(bad);
  });

  it('copias v1, v2 y v3 literales se siguen recuperando', () => {
    const v1 =
      '{"version":1,"exportedAt":"2026-03-10T15:00:00.000Z","accounts":[{"id":"a1","name":"Nu","type":"DIGITAL","initialBalance":{"amount":"100","currency":"COP"}}],"transactions":[],"scheduledExpenses":[]}';
    const v2 =
      '{"version":2,"exportedAt":"2026-03-10T15:00:00.000Z","accounts":[{"id":"a1","name":"Nu","type":"DIGITAL","initialBalance":{"amount":"100","currency":"COP"}}],"transactions":[],"scheduledExpenses":[],"scheduledIncomes":[]}';
    const v3 =
      '{"version":3,"exportedAt":"2026-03-10T15:00:00.000Z","accounts":[{"id":"a1","name":"Nu","type":"DIGITAL","initialBalance":{"amount":"100","currency":"COP"}}],"transactions":[],"scheduledExpenses":[],"scheduledIncomes":[],"creditCards":[{"id":"c1","name":"Visa","dueDay":15,"paymentAccountId":"a1","fee":{"kind":"NONE"},"rate":null,"feeStartMonth":"2026-03","feesSettledThrough":null}],"cardPurchases":[]}';
    expect(err(v1)).toBe('OK');
    expect(err(v2)).toBe('OK');
    const parsed = parseBackup(v3);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.snapshot.creditCards).toHaveLength(1);
    expect(parsed.snapshot.creditCards[0]!.cutDay).toBeUndefined();
  });

  it('un archivo más nuevo sigue dando el aviso', () => {
    expect(err(file(5))).toBe(NEWER);
  });
});
