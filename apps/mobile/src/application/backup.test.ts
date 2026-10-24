import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openFinanzasDb, type FinanzasDb } from '@/data/database';
import { BACKUP_VERSION, backupFileName, isBackupReminderDue, parseBackup } from './backup';
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
