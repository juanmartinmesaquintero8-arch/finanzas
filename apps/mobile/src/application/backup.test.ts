import { Account, Money, ScheduledExpense, TransactionFactory } from '@finanzas/domain';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openFinanzasDb, type FinanzasDb } from '@/data/database';
import {
  BACKUP_VERSION,
  MAX_BACKUP_BYTES,
  MAX_ITEMS,
  backupFileName,
  checkBackupFileSize,
  isBackupReminderDue,
  parseBackup,
  serializeBackup,
} from './backup';
import { generateSampleData } from './sample-data';
import { createServices, type AppServices } from './create-services';

let dbName = '';
let db: FinanzasDb;
let s: AppServices;
let seq = 0;
const NOW = new Date('2026-03-10T15:00:00Z');

beforeEach(async () => {
  dbName = `bk-${Math.random()}`;
  db = await openFinanzasDb(dbName);
  seq = 0;
  s = createServices({ db, now: () => NOW, newId: () => `id-${++seq}` });
});
afterEach(async () => {
  db.close();
  await deleteDB(dbName);
});

async function seed(svc: AppServices) {
  await svc.accounts.create({ name: 'Bancolombia', type: 'BANK', initialBalance: '3000000' });
  await svc.accounts.create({ name: 'Nu', type: 'DIGITAL', initialBalance: '9007199254740993' });
  const [a, b] = await svc.accounts.list();
  await svc.transactions.create({ type: 'INCOME', amount: '2500000', date: '2026-03-05', description: 'Nómina', category: 'Salario', accountId: a!.id });
  await svc.transactions.create({ type: 'TRANSFER', amount: '300000', date: '2026-03-06', description: 'Ahorro', fromAccountId: a!.id, toAccountId: b!.id });
  await svc.scheduled.create({ description: 'Arriendo', amount: '1200000', accountId: a!.id, frequency: 'MONTHLY', startDate: '2026-04-05', endDate: '2026-12-05' });
}

describe('copia de seguridad: exportar', () => {
  it('genera un JSON versionado con cuentas, movimientos y gastos programados', async () => {
    await seed(s);
    const { text, exportedAt, fileName } = await s.backup.create();
    const file = JSON.parse(text);
    expect(file).toMatchObject({ version: BACKUP_VERSION, exportedAt: NOW.toISOString() });
    expect(Object.keys(file)).toEqual(expect.arrayContaining(['version', 'exportedAt', 'accounts', 'transactions', 'scheduledExpenses']));
    expect(file.accounts).toHaveLength(2);
    expect(file.transactions).toHaveLength(2);
    expect(file.scheduledExpenses).toHaveLength(1);
    expect(exportedAt).toBe(NOW.toISOString());
    expect(fileName).toBe('mis-finanzas-2026-03-10.json');
    expect(backupFileName(NOW)).toBe(fileName);
  });

  it('no marca la copia como hecha hasta que se confirma (compartir/descargar)', async () => {
    await seed(s);
    await s.backup.create();
    expect(await s.backup.lastBackupAt()).toBeNull();
    await s.backup.markDone(NOW.toISOString());
    expect(await s.backup.lastBackupAt()).toBe(NOW.toISOString());
  });
});

describe('copia de seguridad: round-trip', () => {
  it('exportar y recuperar en otra base deja exactamente los mismos datos', async () => {
    await seed(s);
    const original = await s.summary.projection('2026-06-30');
    const { text } = await s.backup.create();

    const otherName = `bk-other-${Math.random()}`;
    const otherDb = await openFinanzasDb(otherName);
    try {
      const other = createServices({ db: otherDb, now: () => NOW, newId: () => `x-${++seq}` });
      await other.accounts.create({ name: 'Basura', type: 'CASH', initialBalance: '1' });
      const parsed = parseBackup(text);
      if (!parsed.ok) throw new Error(parsed.error);
      expect(await other.backup.restore(parsed.snapshot)).toEqual({ ok: true });

      expect((await other.accounts.list()).map((a) => a.name).sort()).toEqual(['Bancolombia', 'Nu']);
      expect(await other.summary.projection('2026-06-30')).toEqual(original);
      expect((await other.transactions.page({})).items).toEqual((await s.transactions.page({})).items);
      expect(await other.scheduled.list()).toEqual(await s.scheduled.list());
      // Los montos enormes sobreviven sin perder precisión.
      expect((await other.accounts.list()).find((a) => a.name === 'Nu')?.initialBalance.amount).toBe('9007199254740993');
    } finally {
      otherDb.close();
      await deleteDB(otherName);
    }
  });

  it('restaurar avisa a las pantallas (Observer) y reemplaza todo', async () => {
    await seed(s);
    const { text } = await s.backup.create();
    await s.accounts.create({ name: 'Extra', type: 'CASH', initialBalance: '0' });
    let calls = 0;
    s.bus.subscribe(() => calls++);
    const parsed = parseBackup(text);
    if (!parsed.ok) throw new Error(parsed.error);
    await s.backup.restore(parsed.snapshot);
    expect(calls).toBe(1);
    expect((await s.accounts.list()).map((a) => a.name)).not.toContain('Extra');
  });
});

describe('copia de seguridad: validar y resumir', () => {
  it('muestra un resumen con la cantidad de cuentas, movimientos y programados', async () => {
    await seed(s);
    const { text } = await s.backup.create();
    const parsed = parseBackup(text);
    expect(parsed).toMatchObject({ ok: true, summary: { accounts: 2, transactions: 2, scheduledExpenses: 1, exportedAt: NOW.toISOString() } });
  });

  const rejected = (raw: string) => {
    const r = parseBackup(raw);
    expect(r.ok).toBe(false);
    return r.ok ? '' : r.error;
  };
  const valid = () => ({ version: 1, exportedAt: NOW.toISOString(), accounts: [], transactions: [], scheduledExpenses: [] });
  const account = { id: 'a', name: 'A', type: 'CASH', initialBalance: { amount: '1', currency: 'COP' } };

  it('rechaza texto que no es JSON', () => {
    expect(rejected('hola mundo')).toMatch(/copia de seguridad/i);
    expect(rejected('')).toMatch(/copia de seguridad/i);
  });

  it('rechaza JSON que no tiene la forma esperada', () => {
    expect(rejected('[]')).toMatch(/copia de seguridad/i);
    expect(rejected('{"foo":1}')).toMatch(/copia de seguridad/i);
    expect(rejected(JSON.stringify({ ...valid(), accounts: 'x' }))).toMatch(/copia de seguridad/i);
    expect(rejected(JSON.stringify({ ...valid(), transactions: {} }))).toMatch(/copia de seguridad/i);
  });

  it('rechaza una versión desconocida o más nueva', () => {
    expect(rejected(JSON.stringify({ ...valid(), version: 99 }))).toMatch(/versión más nueva/i);
    expect(rejected(JSON.stringify({ ...valid(), version: 'uno' }))).toMatch(/copia de seguridad/i);
    expect(rejected(JSON.stringify({ ...valid(), version: 0 }))).toMatch(/copia de seguridad/i);
  });

  it('rechaza datos dañados: cuenta sin nombre, tipo raro, monto no numérico', () => {
    expect(rejected(JSON.stringify({ ...valid(), accounts: [{ ...account, name: ' ' }] }))).toMatch(/dañad/i);
    expect(rejected(JSON.stringify({ ...valid(), accounts: [{ ...account, type: 'MAGIA' }] }))).toMatch(/dañad/i);
    expect(rejected(JSON.stringify({ ...valid(), accounts: [{ ...account, initialBalance: { amount: '1.5', currency: 'COP' } }] }))).toMatch(/dañad/i);
    expect(rejected(JSON.stringify({ ...valid(), accounts: [{ id: 'a' }] }))).toMatch(/dañad/i);
  });

  it('rechaza movimientos que apuntan a una cuenta que no existe', () => {
    const tx = { id: 't', type: 'EXPENSE', amount: { amount: '5', currency: 'COP' }, date: '2026-03-01T00:00:00.000Z', description: 'x', category: null, accountId: 'fantasma', fromAccountId: null, toAccountId: null };
    expect(rejected(JSON.stringify({ ...valid(), accounts: [account], transactions: [tx] }))).toMatch(/cuenta/i);
    const se = { id: 's', description: 'x', amount: { amount: '5', currency: 'COP' }, accountId: 'fantasma', frequency: 'MONTHLY', startDate: '2026-03-01', endDate: null, settledThrough: null };
    expect(rejected(JSON.stringify({ ...valid(), accounts: [account], scheduledExpenses: [se] }))).toMatch(/cuenta/i);
  });

  it('rechaza ids repetidos y fechas inválidas', () => {
    expect(rejected(JSON.stringify({ ...valid(), accounts: [account, account] }))).toMatch(/repetid/i);
    const tx = { id: 't', type: 'EXPENSE', amount: { amount: '5', currency: 'COP' }, date: 'ayer', description: 'x', category: null, accountId: 'a', fromAccountId: null, toAccountId: null };
    expect(rejected(JSON.stringify({ ...valid(), accounts: [account], transactions: [tx] }))).toMatch(/dañad/i);
  });

  it('una copia vacía pero bien formada es válida', () => {
    expect(parseBackup(JSON.stringify(valid()))).toMatchObject({ ok: true, summary: { accounts: 0, transactions: 0, scheduledExpenses: 0 } });
  });

  it('un archivo inválido no toca los datos actuales', async () => {
    await seed(s);
    const before = await s.accounts.list();
    parseBackup('{"basura":true}');
    expect(await s.accounts.list()).toEqual(before);
  });
});

describe('recordatorio de copia', () => {
  const day = 86_400_000;
  it('avisa si nunca se hizo copia y ya hay datos', () => {
    expect(isBackupReminderDue({ lastBackupAt: null, hasData: true, now: NOW })).toBe(true);
  });
  it('no molesta si todavía no hay datos', () => {
    expect(isBackupReminderDue({ lastBackupAt: null, hasData: false, now: NOW })).toBe(false);
  });
  it('avisa si pasaron más de 7 días y no antes', () => {
    expect(isBackupReminderDue({ lastBackupAt: new Date(NOW.getTime() - 8 * day).toISOString(), hasData: true, now: NOW })).toBe(true);
    expect(isBackupReminderDue({ lastBackupAt: new Date(NOW.getTime() - 7 * day).toISOString(), hasData: true, now: NOW })).toBe(false);
    expect(isBackupReminderDue({ lastBackupAt: new Date(NOW.getTime() - 1 * day).toISOString(), hasData: true, now: NOW })).toBe(false);
  });
  it('un valor guardado ilegible cuenta como "nunca"', () => {
    expect(isBackupReminderDue({ lastBackupAt: 'basura', hasData: true, now: NOW })).toBe(true);
  });
  it('el servicio lo calcula con los datos reales', async () => {
    expect(await s.backup.reminderDue()).toBe(false);
    await seed(s);
    expect(await s.backup.reminderDue()).toBe(true);
    await s.backup.markDone(NOW.toISOString());
    expect(await s.backup.reminderDue()).toBe(false);
  });
});

describe('datos de ejemplo y borrado total', () => {
  it('carga ejemplos sólo si está vacío y se pueden quitar sin tocar lo propio', async () => {
    expect(await s.data.hasData()).toBe(false);
    expect(await s.data.loadSample()).toEqual({ ok: true });
    expect(await s.data.hasSample()).toBe(true);
    expect((await s.accounts.list()).length).toBeGreaterThan(0);
    expect((await s.summary.projection('2026-06-30')).accounts.length).toBeGreaterThan(0);
    expect((await s.transactions.page({})).items.length).toBeGreaterThan(0);
    expect((await s.scheduled.list()).length).toBeGreaterThan(0);

    // Una cuenta propia con un gasto: sobrevive al borrado de ejemplos.
    await s.accounts.create({ name: 'Mi cuenta', type: 'CASH', initialBalance: '100' });
    const mine = (await s.accounts.list()).find((a) => a.name === 'Mi cuenta')!;
    await s.transactions.create({ type: 'EXPENSE', amount: '10', date: '2026-03-09', description: 'Mío', accountId: mine.id });

    expect(await s.data.removeSample()).toEqual({ ok: true });
    expect(await s.data.hasSample()).toBe(false);
    expect((await s.accounts.list()).map((a) => a.name)).toEqual(['Mi cuenta']);
    expect((await s.transactions.page({})).items.map((t) => t.description)).toEqual(['Mío']);
    expect(await s.scheduled.list()).toEqual([]);
  });

  it('no carga ejemplos si ya hay datos propios', async () => {
    await s.accounts.create({ name: 'Mi cuenta', type: 'CASH', initialBalance: '0' });
    expect(await s.data.loadSample()).toMatchObject({ ok: false });
    expect((await s.accounts.list()).map((a) => a.name)).toEqual(['Mi cuenta']);
  });

  it('borrar todo deja la app vacía y avisa a las pantallas', async () => {
    await seed(s);
    let calls = 0;
    s.bus.subscribe(() => calls++);
    expect(await s.data.eraseAll()).toEqual({ ok: true });
    expect(await s.data.hasData()).toBe(false);
    expect(await s.accounts.list()).toEqual([]);
    expect(calls).toBe(1);
  });
});

describe('límites', () => {
  const TOO_BIG = 'El archivo pesa más de 50 MB, el máximo que la app puede recuperar.';
  const TOO_MANY = 'La copia tiene más datos de los que la app puede manejar, así que no se puede usar.';
  const DAMAGED = 'La copia de seguridad está dañada o incompleta, así que no se puede usar.';
  const UUID = '3f2b8c1e-0000-4000-8000-000000000000';
  const cop = (amount: string) => ({ amount, currency: 'COP' });
  const acc = (over: Record<string, unknown> = {}) => ({ id: 'a1', name: 'Cuenta', type: 'BANK', initialBalance: cop('0'), ...over });
  const tx = (over: Record<string, unknown> = {}) => ({
    id: 't1', type: 'EXPENSE', amount: cop('10'), date: '2026-03-09', description: 'Café', category: 'Comida', accountId: 'a1', ...over,
  });
  const sched = (over: Record<string, unknown> = {}) => ({
    id: 's1', description: 'Arriendo', amount: cop('5'), accountId: 'a1', frequency: 'MONTHLY', startDate: '2026-04-01', endDate: null, settledThrough: null, ...over,
  });
  const backup = (over: Record<string, unknown> = {}) =>
    JSON.stringify({ version: 1, exportedAt: NOW.toISOString(), accounts: [acc()], transactions: [], scheduledExpenses: [], ...over });

  it('(a) una copia que mezcla datos de ejemplo y propios sigue importándose', () => {
    const sample = generateSampleData(NOW);
    const own = {
      accounts: [Account.create({ id: crypto.randomUUID(), name: 'Propia', type: 'BANK', initialBalance: Money.of(5, 'COP') })],
      transactions: [],
      scheduledExpenses: [],
    };
    const mixed = {
      accounts: [...sample.accounts, ...own.accounts],
      transactions: sample.transactions,
      scheduledExpenses: sample.scheduledExpenses,
    };
    const parsed = parseBackup(serializeBackup(mixed, NOW));
    expect(parsed).toMatchObject({
      ok: true,
      summary: { accounts: mixed.accounts.length, transactions: mixed.transactions.length, scheduledExpenses: mixed.scheduledExpenses.length },
    });
  });

  it('(a) un JSON literal de versión 1 con la forma de hoy es válido', () => {
    const text = `{"version":1,"exportedAt":"2026-03-10T15:00:00.000Z","accounts":[{"id":"${UUID}","name":"Nu","type":"DIGITAL","initialBalance":{"amount":"100","currency":"COP"}}],"transactions":[{"id":"demo-t1","type":"INCOME","amount":{"amount":"50","currency":"COP"},"date":"2026-03-05","description":"Nómina","category":"Salario","accountId":"${UUID}"}],"scheduledExpenses":[]}`;
    expect(parseBackup(text)).toMatchObject({ ok: true, summary: { accounts: 1, transactions: 1 } });
  });

  it('(b) el tamaño del archivo se revisa antes de leerlo (50 MB)', () => {
    expect(MAX_BACKUP_BYTES).toBe(50 * 1024 * 1024);
    expect(checkBackupFileSize(MAX_BACKUP_BYTES + 1)).toBe(TOO_BIG);
    expect(checkBackupFileSize(MAX_BACKUP_BYTES)).toBeNull();
  });

  it('(c) los montos aceptan exactamente el rango de int64 y el resto da un mensaje concreto', () => {
    expect(parseBackup(backup({ accounts: [acc({ initialBalance: cop('9223372036854775807') })] })).ok).toBe(true);
    expect(parseBackup(backup({ accounts: [acc({ initialBalance: cop('-9223372036854775808') })] })).ok).toBe(true);
    const big = 'La copia no se puede usar: la cuenta «Cuenta» tiene un monto demasiado grande.';
    expect(parseBackup(backup({ accounts: [acc({ initialBalance: cop('9223372036854775808') })] }))).toEqual({ ok: false, error: big });
    expect(parseBackup(backup({ accounts: [acc({ initialBalance: cop('-9223372036854775809') })] }))).toEqual({ ok: false, error: big });
  });

  it('(d) los textos se aceptan hasta 2000 caracteres sin alterarlos y 2001 se rechaza con mensaje concreto', () => {
    for (const n of [80, 160, 161, 1000, 2000]) {
      const name = 'n'.repeat(n);
      const description = 'd'.repeat(n);
      const category = 'c'.repeat(n);
      const parsed = parseBackup(backup({ accounts: [acc({ name })], transactions: [tx({ description, category })] }));
      if (!parsed.ok) throw new Error(parsed.error);
      expect(parsed.snapshot.accounts[0]!.name).toBe(name);
      expect(parsed.snapshot.transactions[0]!.description).toBe(description);
      expect(parsed.snapshot.transactions[0]!.category).toBe(category);
    }
    const long = (x: string) => `La copia no se puede usar: ${x} tiene un texto demasiado largo (máximo 2.000 caracteres).`;
    const cut = `${'n'.repeat(40)}…`;
    expect(parseBackup(backup({ accounts: [acc({ name: 'n'.repeat(2001) })] }))).toEqual({ ok: false, error: long(`la cuenta «${cut}»`) });
    expect(parseBackup(backup({ transactions: [tx({ description: 'd'.repeat(2001) })] }))).toEqual({
      ok: false,
      error: long(`el movimiento «${'d'.repeat(40)}…»`),
    });
    expect(parseBackup(backup({ transactions: [tx({ category: 'c'.repeat(2001) })] }))).toEqual({ ok: false, error: long('el movimiento «Café»') });
    expect(parseBackup(backup({ scheduledExpenses: [sched({ description: 'g'.repeat(2001) })] }))).toEqual({
      ok: false,
      error: long(`el gasto programado «${'g'.repeat(40)}…»`),
    });
  });

  it('(d2) mensajes concretos: sin recorte si cabe y sin texto identificable', () => {
    const bigMoney = (x: string) => `La copia no se puede usar: ${x} tiene un monto demasiado grande.`;
    const over = cop('9223372036854775808');
    expect(parseBackup(backup({ transactions: [tx({ amount: over })] }))).toEqual({ ok: false, error: bigMoney('el movimiento «Café»') });
    expect(parseBackup(backup({ scheduledExpenses: [sched({ amount: over })] }))).toEqual({ ok: false, error: bigMoney('el gasto programado «Arriendo»') });
    expect(parseBackup(backup({ accounts: [acc({ name: 'n'.repeat(40), initialBalance: over })] }))).toEqual({
      ok: false,
      error: bigMoney(`la cuenta «${'n'.repeat(40)}»`),
    });
    expect(parseBackup(backup({ accounts: [acc({ name: 5, initialBalance: over })] }))).toEqual({ ok: false, error: bigMoney('una cuenta') });
    expect(parseBackup(backup({ accounts: [acc({ name: '', initialBalance: over })] }))).toEqual({ ok: false, error: bigMoney('una cuenta') });
    expect(parseBackup(backup({ transactions: [tx({ description: undefined, amount: over })] }))).toEqual({ ok: false, error: bigMoney('un movimiento') });
    expect(parseBackup(backup({ scheduledExpenses: [sched({ description: null, amount: over })] }))).toEqual({
      ok: false,
      error: bigMoney('un gasto programado'),
    });
    // Otros daños siguen con el mensaje genérico.
    expect(parseBackup(backup({ accounts: [acc({ type: 'MAGIA' })] }))).toEqual({ ok: false, error: DAMAGED });
  });

  it('(e) los ids sólo admiten caracteres seguros y hasta 100', () => {
    for (const id of ['<script>', '', 'x'.repeat(101)]) {
      expect(parseBackup(backup({ accounts: [acc({ id })], transactions: [] }))).toEqual({ ok: false, error: DAMAGED });
    }
    for (const id of ['demo-efectivo', UUID]) {
      expect(parseBackup(backup({ accounts: [acc({ id })] })).ok).toBe(true);
    }
  });

  it('(e2) ids inválidos en accountId, fromAccountId y toAccountId', () => {
    const bad = ['<script>', '', 'x'.repeat(101)];
    for (const v of bad) {
      expect(parseBackup(backup({ transactions: [tx({ accountId: v })] }))).toEqual({ ok: false, error: DAMAGED });
      const tr = { type: 'TRANSFER', accountId: undefined };
      expect(parseBackup(backup({ transactions: [tx({ ...tr, fromAccountId: v, toAccountId: 'a1' })] }))).toEqual({ ok: false, error: DAMAGED });
      expect(parseBackup(backup({ transactions: [tx({ ...tr, fromAccountId: 'a1', toAccountId: v })] }))).toEqual({ ok: false, error: DAMAGED });
      expect(parseBackup(backup({ scheduledExpenses: [sched({ accountId: v })] }))).toEqual({ ok: false, error: DAMAGED });
    }
  });

  it('(f) rechaza demasiados elementos sin procesarlos', () => {
    const many = Array.from({ length: MAX_ITEMS.accounts + 1 }, () => ({}));
    expect(parseBackup(backup({ accounts: many }))).toEqual({ ok: false, error: TOO_MANY });
    expect(parseBackup(backup({ scheduledExpenses: Array.from({ length: MAX_ITEMS.scheduledExpenses + 1 }, () => ({})) }))).toEqual({ ok: false, error: TOO_MANY });
    expect(parseBackup(backup({ transactions: Array.from({ length: MAX_ITEMS.transactions + 1 }, () => ({})) }))).toEqual({ ok: false, error: TOO_MANY });
  });

  it('(g) el largo de description de gastos programados: 2000 sí, 2001 no', () => {
    expect(parseBackup(backup({ scheduledExpenses: [sched({ description: 'g'.repeat(160) })] })).ok).toBe(true);
    expect(parseBackup(backup({ scheduledExpenses: [sched({ description: 'g'.repeat(2000) })] })).ok).toBe(true);
    expect(parseBackup(backup({ scheduledExpenses: [sched({ description: 'g'.repeat(2001) })] })).ok).toBe(false);
  });
});

describe('copia recuperable: comprobación al exportar', () => {
  it('ida y vuelta con textos en el máximo de escritura, extremos int64 y ids UUID y demo-…', async () => {
    const cop = (n: bigint) => Money.of(n, 'COP');
    const uuid = crypto.randomUUID();
    const snapshot = {
      accounts: [
        Account.create({ id: uuid, name: 'n'.repeat(80), type: 'BANK', initialBalance: cop(9223372036854775807n) }),
        Account.create({ id: 'demo-efectivo', name: 'm'.repeat(80), type: 'CASH', initialBalance: cop(-9223372036854775808n) }),
      ],
      transactions: [
        TransactionFactory.create({ id: 'demo-t1', type: 'EXPENSE', accountId: uuid, amount: cop(9223372036854775807n), date: new Date('2026-03-01T00:00:00Z'), description: 'd'.repeat(160), category: 'c'.repeat(60) }),
      ],
      scheduledExpenses: [
        ScheduledExpense.create({ id: crypto.randomUUID(), description: 'g'.repeat(160), amount: cop(1n), accountId: 'demo-efectivo', frequency: 'MONTHLY', startDate: new Date('2026-04-01T00:00:00Z') }),
      ],
    };
    await s.backup.restore(snapshot);
    const created = await s.backup.create();
    expect(created.problem).toBeNull();
    expect(parseBackup(created.text).ok).toBe(true);
  });

  it('un monto ya guardado fuera de rango se nombra en problem', async () => {
    await db.put('accounts', { id: 'a1', name: 'Vieja', type: 'BANK', initialBalance: '9223372036854775808', currency: 'COP' });
    const created = await s.backup.create();
    expect(created.problem).toBe('La copia no se puede usar: la cuenta «Vieja» tiene un monto demasiado grande.');
    expect(created.text).toContain('9223372036854775808');
  });
});
