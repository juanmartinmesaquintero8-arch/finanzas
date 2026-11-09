import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openFinanzasDb, type FinanzasDb } from '@/data/database';
import { BACKUP_VERSION, MAX_ITEMS, parseBackup, serializeBackup } from './backup';
import { createServices, type AppServices } from './create-services';
import { generateSampleData } from './sample-data';

let dbName = '';
let db: FinanzasDb;
let s: AppServices;
let seq = 0;
const NOW = new Date('2026-03-10T15:00:00Z');

beforeEach(async () => {
  dbName = `bk3-${Math.random()}`;
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
const purchase = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  cardId: 'c1',
  description: 'Nevera',
  category: 'Hogar',
  amount: cop('1200000'),
  installments: 12,
  purchaseDate: '2026-03-02',
  firstDueDate: '2026-04-15',
  monthlyRatePpm: 20000,
  paidInstallments: 0,
  closedOn: null,
  dueDayAnchor: 15,
  ...over,
});
const v3 = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ version: 3, exportedAt: NOW.toISOString(), accounts: [acc], transactions: [], scheduledExpenses: [], scheduledIncomes: [], creditCards: [card()], cardPurchases: [purchase()], ...over });
const err = (text: string) => {
  const r = parseBackup(text);
  return r.ok ? 'OK' : r.error;
};

describe('copia v3: tarjetas y compras', () => {
  it('la versión es 3 y los topes son 100 tarjetas y 5.000 compras', () => {
    expect(BACKUP_VERSION).toBe(3);
    expect(MAX_ITEMS.creditCards).toBe(100);
    expect(MAX_ITEMS.cardPurchases).toBe(5000);
  });

  it('ida y vuelta: conserva tarjetas, compras, ancla, pagos y lo ya pagado de manejo', async () => {
    await s.accounts.create({ name: 'Banco', type: 'BANK', initialBalance: '3000000' });
    const [a] = await s.accounts.list();
    await s.cards.createCard({ name: 'Visa', dueDay: 31, paymentAccountId: a!.id, feeKind: 'FIXED_MONTHLY', feeAmount: '18000', rateBasis: 'EA', rateText: '26,82' });
    const [c] = await s.cards.list();
    await s.cards.addPurchase({ cardId: c!.id, description: 'Nevera', amount: '1200000', installments: 12, purchaseDate: '2026-01-20', firstDueDate: '2026-02-28', category: 'Hogar' });
    await s.cards.addPurchase({ cardId: c!.id, description: 'Libro', amount: '50000', installments: 1, purchaseDate: '2026-03-02', firstDueDate: '2026-03-20', withoutInterest: true });
    const nevera = (await db.getAll('cardPurchases')).find((p) => p.description === 'Nevera')!;
    await s.cards.payInstallment(nevera.id, { fromAccountId: a!.id, paidOn: '2026-03-05' });
    await s.cards.payFee(c!.id, '2026-03', { fromAccountId: a!.id, paidOn: '2026-03-06' });

    const { text, problem } = await s.backup.create();
    expect(problem).toBeNull();
    expect(JSON.parse(text).version).toBe(3);

    const otherName = `bk3-otro-${Math.random()}`;
    const otherDb = await openFinanzasDb(otherName);
    try {
      const other = createServices({ db: otherDb, now: () => NOW, newId: () => `o-${++seq}` });
      const parsed = parseBackup(text);
      if (!parsed.ok) throw new Error(parsed.error);
      expect(parsed.summary).toMatchObject({ creditCards: 1, cardPurchases: 2 });
      expect(await other.backup.restore(parsed.snapshot)).toEqual({ ok: true });
      expect(await other.cards.list()).toEqual(await s.cards.list());
      expect(await otherDb.getAll('cardPurchases')).toEqual(await db.getAll('cardPurchases'));
      expect((await otherDb.get('cardPurchases', nevera.id))!.dueDayAnchor).toBe(31);
      expect((await other.transactions.page({})).items).toEqual((await s.transactions.page({})).items);
    } finally {
      otherDb.close();
      await deleteDB(otherName);
    }
  });

  it('los datos de ejemplo producen una copia válida', () => {
    const parsed = parseBackup(serializeBackup(generateSampleData(NOW), NOW));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.summary).toMatchObject({ creditCards: 1, cardPurchases: 1 });
  });

  it('dueDayAnchor es opcional', () => {
    const { dueDayAnchor: _omit, ...without } = purchase();
    const parsed = parseBackup(v3({ cardPurchases: [without] }));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.snapshot.cardPurchases[0]!.dueDayAnchor).toBeUndefined();
    expect(err(v3({ cardPurchases: [purchase({ dueDayAnchor: null })] }))).toBe('OK');
    expect(err(v3({ cardPurchases: [purchase({ dueDayAnchor: 32 })] }))).toBe(`${prefix}la compra «Nevera» tiene datos que no son válidos.`);
  });

  it('una tarjeta sin manejo ni tasa, y una compra cerrada, se aceptan', () => {
    expect(err(v3({ creditCards: [card({ fee: { kind: 'NONE' }, rate: null })], cardPurchases: [purchase({ monthlyRatePpm: 0, closedOn: '2026-04-20' })] }))).toBe('OK');
  });

  it('en v3 las listas son obligatorias', () => {
    const file = JSON.parse(v3());
    const { creditCards: _a, ...noCards } = file;
    const { cardPurchases: _b, ...noPurchases } = file;
    expect(err(JSON.stringify({ ...noCards, cardPurchases: [] }))).toBe(DAMAGED);
    expect(err(JSON.stringify(noPurchases))).toBe(DAMAGED);
  });

  it('una copia v1 literal se recupera sin tarjetas y borra las que había', async () => {
    const text =
      '{"version":1,"exportedAt":"2026-03-10T15:00:00.000Z","accounts":[{"id":"a1","name":"Nu","type":"DIGITAL","initialBalance":{"amount":"100","currency":"COP"}}],"transactions":[],"scheduledExpenses":[{"id":"s1","description":"Arriendo","amount":{"amount":"5","currency":"COP"},"accountId":"a1","frequency":"MONTHLY","startDate":"2026-04-01","endDate":null,"settledThrough":null}]}';
    const parsed = parseBackup(text);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.snapshot.creditCards).toEqual([]);
    expect(parsed.snapshot.cardPurchases).toEqual([]);
    expect(parsed.summary).toMatchObject({ creditCards: 0, cardPurchases: 0 });
    await s.accounts.create({ name: 'Previa', type: 'CASH', initialBalance: '0' });
    const [a] = await s.accounts.list();
    await s.cards.createCard({ name: 'Visa', dueDay: 15, paymentAccountId: a!.id, feeKind: 'NONE' });
    expect(await s.backup.restore(parsed.snapshot)).toEqual({ ok: true });
    expect(await s.cards.list()).toEqual([]);
  });

  it('una copia v2 literal se recupera sin tarjetas', () => {
    const text =
      '{"version":2,"exportedAt":"2026-03-10T15:00:00.000Z","accounts":[{"id":"a1","name":"Nu","type":"DIGITAL","initialBalance":{"amount":"100","currency":"COP"}}],"transactions":[],"scheduledExpenses":[],"scheduledIncomes":[{"id":"i1","description":"Sueldo","amount":{"amount":"5","currency":"COP"},"accountId":"a1","frequency":"MONTHLY","startDate":"2026-04-30","endDate":null,"settledThrough":null,"category":"Salario"}]}';
    const parsed = parseBackup(text);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.snapshot.scheduledIncomes).toHaveLength(1);
    expect(parsed.snapshot.creditCards).toEqual([]);
  });

  it('un archivo más nuevo sigue dando el aviso', () => {
    expect(err(v3({ version: 4 }))).toBe(NEWER);
  });

  it('respeta los topes', () => {
    expect(err(v3({ creditCards: Array.from({ length: 101 }, () => ({})) }))).toBe(TOO_MANY);
    expect(err(v3({ cardPurchases: Array.from({ length: 5001 }, () => ({})) }))).toBe(TOO_MANY);
  });

  it('exige ids únicos', () => {
    expect(err(v3({ creditCards: [card(), card()] }))).toMatch(/repetidos/i);
    expect(err(v3({ cardPurchases: [purchase(), purchase()] }))).toMatch(/repetidos/i);
  });

  describe('mensajes concretos', () => {
    const c = (msg: string) => `${prefix}la tarjeta «Visa» ${msg}`;
    const p = (msg: string) => `${prefix}la compra «Nevera» ${msg}`;

    it('la tarjeta y la compra deben existir', () => {
      expect(err(v3({ creditCards: [card({ paymentAccountId: 'fantasma' })] }))).toBe(c('se paga desde una cuenta que no existe en la copia.'));
      expect(err(v3({ cardPurchases: [purchase({ cardId: 'fantasma' })] }))).toBe(p('es de una tarjeta que no existe en la copia.'));
    });

    it('nombra el dato cuando el texto es largo o el monto es enorme; sin nombre, usa el genérico', () => {
      const long = 'tiene un texto demasiado largo (máximo 2.000 caracteres).';
      expect(err(v3({ creditCards: [card({ name: 'g'.repeat(2001) })] }))).toBe(`${prefix}la tarjeta «${'g'.repeat(40)}…» ${long}`);
      expect(err(v3({ cardPurchases: [purchase({ category: 'g'.repeat(2001) })] }))).toBe(p(long));
      expect(err(v3({ creditCards: [card({ fee: { kind: 'FIXED_MONTHLY', amount: cop('9223372036854775808') } })] }))).toBe(c('tiene un monto demasiado grande.'));
      expect(err(v3({ cardPurchases: [purchase({ amount: cop('9223372036854775808') })] }))).toBe(p('tiene un monto demasiado grande.'));
      expect(err(v3({ creditCards: [card({ name: null, rate: { basis: 'MV', ppm: 1.5 } })] }))).toBe(`${prefix}una tarjeta tiene una tasa de interés que no es válida.`);
      expect(err(v3({ cardPurchases: [purchase({ description: null, monthlyRatePpm: -1 })] }))).toBe(`${prefix}una compra tiene una tasa de interés que no es válida.`);
    });

    it('ppm entero y en rango', () => {
      const bad = c('tiene una tasa de interés que no es válida.');
      for (const rate of [{ basis: 'MV', ppm: 0 }, { basis: 'MV', ppm: 100_001 }, { basis: 'EA', ppm: 2_000_001 }, { basis: 'MV', ppm: '1' }, { basis: 'XX', ppm: 1 }, 'x']) {
        expect(err(v3({ creditCards: [card({ rate })] }))).toBe(bad);
      }
      expect(err(v3({ cardPurchases: [purchase({ monthlyRatePpm: 100_001 })] }))).toBe(p('tiene una tasa de interés que no es válida.'));
      expect(err(v3({ cardPurchases: [purchase({ monthlyRatePpm: 1.5 })] }))).toBe(p('tiene una tasa de interés que no es válida.'));
    });

    it('cuotas pagadas no pueden superar el total', () => {
      expect(err(v3({ cardPurchases: [purchase({ paidInstallments: 13 })] }))).toBe(p('tiene más cuotas pagadas que cuotas.'));
      expect(err(v3({ cardPurchases: [purchase({ paidInstallments: 12 })] }))).toBe('OK');
    });

    it('fechas, ids y demás datos inválidos nombran la compra o la tarjeta', () => {
      expect(err(v3({ cardPurchases: [purchase({ purchaseDate: 'ayer' })] }))).toBe(p('tiene una fecha que no es válida.'));
      expect(err(v3({ cardPurchases: [purchase({ installments: 73 })] }))).toBe(p('tiene datos que no son válidos.'));
      expect(err(v3({ creditCards: [card({ dueDay: 32 })] }))).toBe(c('tiene datos que no son válidos.'));
      expect(err(v3({ creditCards: [card({ feeStartMonth: 'marzo' })] }))).toBe(c('tiene datos que no son válidos.'));
      expect(err(v3({ cardPurchases: [purchase({ id: 'x'.repeat(81) })] }))).toBe(p('tiene un identificador demasiado largo.'));
      expect(err(v3({ cardPurchases: [purchase({ id: 'x'.repeat(80) })] }))).toBe('OK');
      expect(err(v3({ creditCards: [card({ id: 'x'.repeat(81) })], cardPurchases: [] }))).toBe(c('tiene un identificador demasiado largo.'));
    });
  });
});
