import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openFinanzasDb, type FinanzasDb } from '@/data/database';
import { IdbCardPaymentRepository } from '@/data/idb-card.repository';
import { BACKUP_VERSION, MAX_ITEMS, parseBackup } from './backup';
import { createServices, type AppServices } from './create-services';

let dbName = '';
let db: FinanzasDb;
let s: AppServices;
let seq = 0;
let now = new Date('2026-03-10T15:00:00Z');

beforeEach(async () => {
  now = new Date('2026-03-10T15:00:00Z');
  dbName = `bk5-${Math.random()}`;
  db = await openFinanzasDb(dbName);
  seq = 0;
  s = createServices({ db, now: () => now, newId: () => `id-${++seq}` });
});
afterEach(async () => {
  db.close();
  await deleteDB(dbName);
});

const prefix = 'La copia no se puede usar: ';
const DAMAGED = 'La copia de seguridad está dañada o incompleta, así que no se puede usar.';
const TOO_MANY = 'La copia tiene más datos de los que la app puede manejar, así que no se puede usar.';
const cop = (n: string) => ({ amount: n, currency: 'COP' });

const acc = { id: 'a1', name: 'Banco', type: 'BANK', initialBalance: cop('5000000') };
const card = { id: 'c1', name: 'Visa', dueDay: 15, cutDay: null, paymentAccountId: 'a1', fee: { kind: 'NONE' }, rate: { basis: 'MV', ppm: 20000 }, feeStartMonth: '2026-03', feesSettledThrough: null };
const purchase = {
  id: 'p1', cardId: 'c1', description: 'Nevera', category: 'Hogar', amount: cop('1200000'), installments: 12, purchaseDate: '2026-03-02', firstDueDate: '2026-04-15',
  monthlyRatePpm: 20000, paidInstallments: 0, closedOn: null, dueDayAnchor: 15,
};
const tx = (id: string, amount: string) => ({ id, type: 'EXPENSE', amount: cop(amount), date: '2026-04-15T00:00:00.000Z', description: 'Pago', category: null, accountId: 'a1' });
const payment = (over: Record<string, unknown> = {}) => ({
  id: 'pago-1',
  cardId: 'c1',
  seq: 1,
  paidOn: '2026-04-15',
  fromAccountId: 'a1',
  total: cop('50000'),
  extraMode: null,
  allocations: [{ kind: 'INSTALLMENT', purchaseId: 'p1', number: 1, interest: cop('24000'), capital: cop('26000') }],
  transactionIds: ['pt-pago-1-01', 'pt-pago-1-02'],
  ...over,
});
const file = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    version: 5,
    exportedAt: now.toISOString(),
    accounts: [acc],
    transactions: [tx('pt-pago-1-01', '26000'), tx('pt-pago-1-02', '24000')],
    scheduledExpenses: [],
    scheduledIncomes: [],
    creditCards: [card],
    cardPurchases: [purchase],
    cardPayments: [payment()],
    ...over,
  });
const err = (text: string) => {
  const r = parseBackup(text);
  return r.ok ? 'OK' : r.error;
};
const who = `${prefix}un pago de la tarjeta «Visa»`;

describe('copia v5: pagos de tarjeta', () => {
  it('la versión es 5 y una copia válida trae los pagos', () => {
    expect(BACKUP_VERSION).toBe(5);
    const parsed = parseBackup(file());
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.summary.cardPayments).toBe(1);
    expect(parsed.snapshot.cardPayments[0]).toMatchObject({ id: 'pago-1', cardId: 'c1', seq: 1, transactionIds: ['pt-pago-1-01', 'pt-pago-1-02'] });
    expect(parsed.snapshot.cardPayments[0]!.paidOn.toISOString()).toBe('2026-04-15T00:00:00.000Z');
  });

  it('ida y vuelta: pagos parcial, con plata de más y con manejo; todo queda igual', async () => {
    await s.accounts.create({ name: 'Banco', type: 'BANK', initialBalance: '5000000' });
    const [a] = await s.accounts.list();
    await s.cards.createCard({ name: 'Visa', dueDay: 15, paymentAccountId: a!.id, feeKind: 'FIXED_MONTHLY', feeAmount: '18000', rateBasis: 'MV', rateText: '2' });
    const [c] = await s.cards.list();
    await s.cards.addPurchase({ cardId: c!.id, description: 'Nevera', amount: '1200000', installments: 12, purchaseDate: '2026-03-02', firstDueDate: '2026-04-15', category: 'Hogar' });
    now = new Date('2026-04-15T15:00:00Z');
    const pay = (paymentId: string, amount: string, mode?: 'SHORTEN' | 'LOWER') => s.cards.payCard(c!.id, { paymentId, amount, paidOn: '2026-04-15', fromAccountId: a!.id, mode });
    expect(await pay('pago-1', '50000')).toEqual({ ok: true });
    expect(await pay('pago-2', '92000')).toEqual({ ok: true });
    expect(await pay('pago-3', '300000', 'LOWER')).toEqual({ ok: true });

    const { text, problem } = await s.backup.create();
    expect(problem).toBeNull();
    expect(JSON.parse(text).cardPayments).toHaveLength(3);
    const parsed = parseBackup(text);
    if (!parsed.ok) throw new Error(parsed.error);

    const otherName = `bk5-otro-${Math.random()}`;
    const otherDb = await openFinanzasDb(otherName);
    try {
      const other = createServices({ db: otherDb, now: () => now, newId: () => `o-${++seq}` });
      expect(await other.backup.restore(parsed.snapshot)).toEqual({ ok: true });
      expect(await new IdbCardPaymentRepository(otherDb).findAll()).toEqual(await new IdbCardPaymentRepository(db).findAll());
      expect(await other.cards.list()).toEqual(await s.cards.list());
      expect(await other.summary.projection('2026-12-31')).toEqual(await s.summary.projection('2026-12-31'));
      expect(await other.cards.debtSummary()).toEqual(await s.cards.debtSummary());
      expect((await other.backup.create()).text).toBe(text);
      // Lo recuperado sigue funcionando: se puede deshacer el último pago.
      expect(await other.cards.undoLastCardPayment(c!.id)).toEqual({ ok: true });
    } finally {
      otherDb.close();
      await deleteDB(otherName);
    }
  });

  it('una copia v5 sin la lista de pagos está dañada', () => {
    const raw = JSON.parse(file());
    delete raw.cardPayments;
    expect(err(JSON.stringify(raw))).toBe(DAMAGED);
  });

  it('copias v1 a v4 literales se recuperan sin pagos', () => {
    const accounts = '"accounts":[{"id":"a1","name":"Nu","type":"DIGITAL","initialBalance":{"amount":"100","currency":"COP"}}],"transactions":[],"scheduledExpenses":[]';
    const cards =
      '"creditCards":[{"id":"c1","name":"Visa","dueDay":15,"paymentAccountId":"a1","fee":{"kind":"NONE"},"rate":null,"feeStartMonth":"2026-03","feesSettledThrough":null}],"cardPurchases":[{"id":"p1","cardId":"c1","description":"TV","category":null,"amount":{"amount":"1200000","currency":"COP"},"installments":12,"purchaseDate":"2026-03-02","firstDueDate":"2026-04-15","monthlyRatePpm":0,"paidInstallments":3,"closedOn":null}]';
    const cardsV4 = cards.replace('"dueDay":15,', '"dueDay":15,"cutDay":30,').replace('"closedOn":null}', '"closedOn":null,"dueDayAnchor":15}');
    const files = [
      `{"version":1,"exportedAt":"2026-03-10T15:00:00.000Z",${accounts}}`,
      `{"version":2,"exportedAt":"2026-03-10T15:00:00.000Z",${accounts},"scheduledIncomes":[]}`,
      `{"version":3,"exportedAt":"2026-03-10T15:00:00.000Z",${accounts},"scheduledIncomes":[],${cards}}`,
      `{"version":4,"exportedAt":"2026-03-10T15:00:00.000Z",${accounts},"scheduledIncomes":[],${cardsV4}}`,
    ];
    for (const text of files) {
      const parsed = parseBackup(text);
      if (!parsed.ok) throw new Error(parsed.error);
      expect(parsed.snapshot.cardPayments).toEqual([]);
      expect(parsed.summary.cardPayments).toBe(0);
    }
  });

  it('tope de pagos', () => {
    expect(MAX_ITEMS.cardPayments).toBe(20_000);
    expect(err(file({ cardPayments: Array.from({ length: 20_001 }, () => ({})) }))).toBe(TOO_MANY);
  });

  it('un reparto que no suma el total', () => {
    expect(err(file({ cardPayments: [payment({ total: cop('50001') })] }))).toBe(`${who} tiene un reparto que no suma el total.`);
  });

  it('montos inválidos', () => {
    const inst = (interest: string, capital: string) => [{ kind: 'INSTALLMENT', purchaseId: 'p1', number: 1, interest: cop(interest), capital: cop(capital) }];
    expect(err(file({ cardPayments: [payment({ total: cop('0'), allocations: inst('0', '0') })] }))).toBe(`${who} tiene datos que no son válidos.`);
    expect(err(file({ cardPayments: [payment({ total: cop('50000'), allocations: inst('-1', '50001') })] }))).toBe(`${who} tiene datos que no son válidos.`);
    expect(err(file({ cardPayments: [payment({ total: cop('99999999999999999999') })] }))).toBe(`${who} tiene un monto demasiado grande.`);
    expect(err(file({ cardPayments: [payment({ total: { amount: '1.5', currency: 'COP' } })] }))).toBe(DAMAGED);
    // Más capital que el de la cuota: el cálculo de la deuda no cuadra.
    expect(err(file({ cardPayments: [payment({ total: cop('150000'), allocations: inst('24000', '126000') })] }))).toBe(`${who} tiene datos que no son válidos.`);
  });

  it('el orden de los pagos no se repite en una tarjeta y sus fechas no retroceden', () => {
    const second = payment({ id: 'pago-2', allocations: [{ kind: 'INSTALLMENT', purchaseId: 'p1', number: 1, interest: cop('0'), capital: cop('1000') }], total: cop('1000'), transactionIds: [] });
    expect(err(file({ cardPayments: [payment(), second] }))).toBe(`${who} tiene el mismo orden que otro pago de esa tarjeta.`);
    expect(err(file({ cardPayments: [payment({ paidOn: '2026-04-16' }), { ...second, seq: 2, paidOn: '2026-04-15' }] }))).toBe(`${who} tiene datos que no son válidos.`);
    expect(err(file({ cardPayments: [payment(), { ...second, seq: 2 }] }))).toBe('OK');
  });

  it('referencias: tarjeta, cuenta, compra y movimientos', () => {
    expect(err(file({ cardPayments: [payment({ cardId: 'otra' })] }))).toBe(`${prefix}un pago es de una tarjeta que no existe en la copia.`);
    expect(err(file({ cardPayments: [payment({ fromAccountId: 'otra' })] }))).toBe(`${who} se pagó desde una cuenta que no existe en la copia.`);
    expect(err(file({ cardPayments: [payment({ transactionIds: ['pt-pago-1-01', 'pt-pago-1-09'] })] }))).toBe(`${who} tiene movimientos que no están en la copia.`);
    const card2 = { ...card, id: 'c2', name: 'Master' };
    const purchase2 = { ...purchase, id: 'p2', cardId: 'c2' };
    expect(
      err(file({ creditCards: [card, card2], cardPurchases: [purchase, purchase2], cardPayments: [payment({ allocations: [{ kind: 'INSTALLMENT', purchaseId: 'p2', number: 1, interest: cop('24000'), capital: cop('26000') }] })] })),
    ).toBe(`${who} reparte plata a una compra de otra tarjeta.`);
    const other = payment({ id: 'pago-2', seq: 2, total: cop('1000'), allocations: [{ kind: 'INSTALLMENT', purchaseId: 'p1', number: 1, interest: cop('0'), capital: cop('1000') }], transactionIds: ['pt-pago-1-01'] });
    expect(err(file({ cardPayments: [payment(), other] }))).toBe(`${who} comparte un movimiento con otro pago.`);
  });

  it('una compra borrada después del pago no impide recuperar la copia (el cálculo ignora lo que iba a ella)', () => {
    expect(err(file({ cardPurchases: [] }))).toBe('OK');
  });

  it('identificadores dentro del formato permitido', () => {
    expect(err(file({ cardPayments: [payment({ id: 'con espacio' })] }))).toBe(`${who} tiene un identificador que no es válido.`);
    expect(err(file({ cardPayments: [payment({ id: 'x'.repeat(81) })] }))).toBe(`${who} tiene un identificador demasiado largo.`);
    expect(err(file({ cardPayments: [payment({ transactionIds: ['pt pago'] })] }))).toBe(`${who} tiene un identificador que no es válido.`);
  });

  it('modo de plata de más y fecha', () => {
    const extra = { kind: 'EXTRA', purchaseId: 'p1', capital: cop('10000') };
    const allocations = [...payment().allocations as unknown[], extra];
    expect(err(file({ cardPayments: [payment({ total: cop('60000'), allocations })] }))).toBe(`${who} tiene datos que no son válidos.`);
    expect(err(file({ cardPayments: [payment({ extraMode: 'SHORTEN' })] }))).toBe(`${who} tiene datos que no son válidos.`);
    expect(err(file({ cardPayments: [payment({ paidOn: '1999-01-01' })] }))).toBe(`${who} tiene una fecha que no es válida.`);
    expect(err(file({ cardPayments: [payment({ allocations: [{ kind: 'OTRO' }] })] }))).toBe(`${who} tiene datos que no son válidos.`);
  });

  it('pagos repetidos', () => {
    expect(err(file({ cardPayments: [payment(), payment({ seq: 2 })] }))).toBe('La copia tiene datos repetidos, así que no se puede usar.');
  });
});
