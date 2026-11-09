import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openFinanzasDb, type FinanzasDb } from '@/data/database';
import { createServices, type AppServices } from './create-services';
import { SAMPLE_PREFIX } from './sample-data';

let dbName = '';
let db: FinanzasDb;
let s: AppServices;

beforeEach(async () => {
  dbName = `sample-inc-${Math.random()}`;
  db = await openFinanzasDb(dbName);
  s = createServices({ db, now: () => new Date('2026-03-10T15:00:00Z') });
});
afterEach(async () => {
  db.close();
  await deleteDB(dbName);
});

describe('datos de ejemplo con ingreso programado', () => {
  it('incluyen un Sueldo mensual con prefijo demo- en una cuenta de ejemplo', async () => {
    expect(await s.data.loadSample()).toEqual({ ok: true });
    const incomes = await s.scheduledIncomes.list();
    expect(incomes).toHaveLength(1);
    expect(incomes[0]).toMatchObject({ id: `${SAMPLE_PREFIX}sueldo`, description: 'Sueldo', frequency: 'MONTHLY', category: 'Salario' });
    expect(incomes[0]!.accountId.startsWith(SAMPLE_PREFIX)).toBe(true);
    expect(incomes[0]!.startDate >= '2026-03-10').toBe(true);
  });

  it('Quitar datos de ejemplo conserva los ingresos propios y borra el de ejemplo', async () => {
    await s.data.loadSample();
    await s.accounts.create({ name: 'Mi cuenta', type: 'BANK', initialBalance: '0' });
    const mine = (await s.accounts.list()).find((a) => a.name === 'Mi cuenta')!;
    await s.scheduledIncomes.create({ description: 'Freelance', amount: '100', accountId: mine.id, frequency: 'MONTHLY', startDate: '2026-03-20' });
    expect(await s.data.removeSample()).toEqual({ ok: true });
    expect((await s.scheduledIncomes.list()).map((i) => i.description)).toEqual(['Freelance']);
  });

  it('Borrar todo limpia los ingresos programados', async () => {
    await s.data.loadSample();
    expect(await s.data.eraseAll()).toEqual({ ok: true });
    expect(await s.scheduledIncomes.list()).toEqual([]);
    expect(await db.count('scheduledIncomes')).toBe(0);
  });
});
