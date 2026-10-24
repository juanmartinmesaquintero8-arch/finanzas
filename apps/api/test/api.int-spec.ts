import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { TEST_DATABASE_URL } from './global-setup';

process.env.DATABASE_URL = TEST_DATABASE_URL;

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { CACHE_PORT, CachePort } from '../src/application/ports/cache.port';
import { CLOCK } from '../src/application/ports/clock.port';
import { FixedClock } from '../src/application/testing/in-memory';

describe('API (integración e2e contra finanzas_test)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let cache: CachePort;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(new FixedClock(new Date('2026-10-24T15:00:00Z')))
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    cache = app.get<CachePort>(CACHE_PORT);
    prisma = new PrismaClient({ datasourceUrl: TEST_DATABASE_URL });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE transactions, scheduled_expenses, accounts CASCADE');
    await cache.deleteByPrefix('');
  });

  async function createAccounts() {
    const make = async (name: string, type: string, initialBalance: string) =>
      (await http().post('/accounts').send({ name, type, initialBalance }).expect(201)).body as { id: string };
    return {
      cash: await make('Efectivo', 'CASH', '100000'),
      bank: await make('Bancolombia', 'BANK', '2000000'),
      nu: await make('Nu', 'DIGITAL', '0'),
    };
  }

  describe('cuentas', () => {
    it('crea, lista y consulta cuentas con montos como string', async () => {
      const { cash } = await createAccounts();
      const list = await http().get('/accounts').expect(200);
      expect(list.body.map((a: { name: string }) => a.name).sort()).toEqual(['Bancolombia', 'Efectivo', 'Nu']);
      const one = await http().get(`/accounts/${cash.id}`).expect(200);
      expect(one.body).toMatchObject({ name: 'Efectivo', type: 'CASH', initialBalance: { amount: '100000', currency: 'COP' } });
    });

    it('responde 404 para una cuenta inexistente y 400 para un id mal formado', async () => {
      const res = await http().get('/accounts/00000000-0000-4000-8000-000000000000').expect(404);
      expect(res.body.message).toMatch(/no encontrada/i);
      await http().get('/accounts/no-es-uuid').expect(400);
    });

    it('valida el cuerpo con 400 y mensajes en español', async () => {
      const res = await http().post('/accounts').send({ name: '', type: 'NOPE' }).expect(400);
      expect(JSON.stringify(res.body.message)).toMatch(/nombre|tipo/i);
    });

    it('rechaza montos decimales con 400', async () => {
      await http().post('/accounts').send({ name: 'X', type: 'CASH', initialBalance: '10.5' }).expect(400);
    });
  });

  describe('transacciones y resumen', () => {
    it('ingreso, gasto y transferencia producen el resumen correcto; la transferencia no cambia el patrimonio', async () => {
      const { cash, bank, nu } = await createAccounts();
      await http().post('/transactions').send({ type: 'INCOME', accountId: bank.id, amount: '3000000', description: 'Salario' }).expect(201);
      await http().post('/transactions').send({ type: 'EXPENSE', accountId: cash.id, amount: '40000', description: 'Almuerzo' }).expect(201);

      const before = (await http().get('/summary').expect(200)).body;
      expect(before.netWorth).toEqual({ amount: '5060000', currency: 'COP' });

      await http()
        .post('/transactions')
        .send({ type: 'TRANSFER', fromAccountId: bank.id, toAccountId: nu.id, amount: '1000000', description: 'Ahorro' })
        .expect(201);

      const after = (await http().get('/summary').expect(200)).body;
      expect(after.netWorth).toEqual(before.netWorth);
      const byName = Object.fromEntries(after.accounts.map((a: { name: string; balance: { amount: string } }) => [a.name, a.balance.amount]));
      expect(byName).toEqual({ Efectivo: '60000', Bancolombia: '4000000', Nu: '1000000' });
    });

    it('404 si la cuenta referenciada no existe; 422 si viola una invariante; 400 si el cuerpo es inválido', async () => {
      const { cash } = await createAccounts();
      const ghost = '00000000-0000-4000-8000-000000000000';
      const notFound = await http().post('/transactions').send({ type: 'INCOME', accountId: ghost, amount: '1', description: 'x' }).expect(404);
      expect(notFound.body.message).toMatch(/cuenta desconocida/i);
      const unprocessable = await http().post('/transactions').send({ type: 'INCOME', accountId: cash.id, amount: '0', description: 'x' }).expect(422);
      expect(unprocessable.body.message).toMatch(/mayor que cero/i);
      await http().post('/transactions').send({ type: 'TRANSFER', fromAccountId: cash.id, toAccountId: cash.id, amount: '5', description: 'x' }).expect(422);
      await http().post('/transactions').send({ type: 'BOGUS', accountId: cash.id, amount: '1', description: 'x' }).expect(400);
    });

    it('elimina una transacción y el resumen lo refleja; 404 al borrar de nuevo', async () => {
      const { cash } = await createAccounts();
      const tx = await http().post('/transactions').send({ type: 'INCOME', accountId: cash.id, amount: '900', description: 'x' }).expect(201);
      expect((await http().get('/summary')).body.netWorth.amount).toBe('2100900');
      await http().delete(`/transactions/${tx.body.id}`).expect(204);
      expect((await http().get('/summary')).body.netWorth.amount).toBe('2100000');
      await http().delete(`/transactions/${tx.body.id}`).expect(404);
    });

    it('pagina el historial por cursor keyset sin repetir ni omitir', async () => {
      const { cash, bank } = await createAccounts();
      for (let day = 1; day <= 5; day++) {
        await http()
          .post('/transactions')
          .send({ type: 'EXPENSE', accountId: cash.id, amount: String(day), date: `2026-10-0${day}T10:00:00Z`, description: `Gasto ${day}` })
          .expect(201);
      }
      await http().post('/transactions').send({ type: 'INCOME', accountId: bank.id, amount: '7', date: '2026-10-10T10:00:00Z', description: 'Banco' }).expect(201);
      await http()
        .post('/transactions')
        .send({ type: 'TRANSFER', fromAccountId: bank.id, toAccountId: cash.id, amount: '3', date: '2026-10-11T10:00:00Z', description: 'Mov' })
        .expect(201);

      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const res = await http().get('/transactions').query({ limit: 3, ...(cursor ? { cursor } : {}) }).expect(200);
        seen.push(...res.body.items.map((t: { description: string }) => t.description));
        cursor = res.body.nextCursor ?? undefined;
        pages += 1;
      } while (cursor);
      expect(pages).toBe(3);
      expect(seen).toEqual(['Mov', 'Banco', 'Gasto 5', 'Gasto 4', 'Gasto 3', 'Gasto 2', 'Gasto 1']);

      // Filtro por cuenta: incluye transferencias entrantes y salientes
      const byBank = await http().get('/transactions').query({ accountId: bank.id }).expect(200);
      expect(byBank.body.items.map((t: { description: string }) => t.description)).toEqual(['Mov', 'Banco']);
      expect(byBank.body.nextCursor).toBeNull();

      await http().get('/transactions').query({ cursor: '%%%' }).expect(400);
    });
  });

  describe('gastos programados y proyección', () => {
    it('calcula el Saldo Real Disponible con un gasto mensual y su desglose por cuenta', async () => {
      const { bank } = await createAccounts();
      const created = await http()
        .post('/scheduled-expenses')
        .send({ description: 'Arriendo', amount: '800000', accountId: bank.id, frequency: 'MONTHLY', startDate: '2026-11-05' })
        .expect(201);
      expect(created.body).toMatchObject({ frequency: 'MONTHLY', startDate: '2026-11-05', settledThrough: null });

      const res = await http().get('/projection').query({ to: '2027-01-31' }).expect(200);
      expect(res.body.netWorth.amount).toBe('2100000');
      expect(res.body.committed.amount).toBe('2400000');
      expect(res.body.availableBalance.amount).toBe('-300000');
      expect(res.body.isShortfall).toBe(true);
      expect(res.body.commitments).toHaveLength(3);
      expect(res.body.accounts.find((a: { name: string }) => a.name === 'Bancolombia')).toMatchObject({
        balance: { amount: '2000000' },
        committed: { amount: '2400000' },
        available: { amount: '-400000' },
      });

      const list = await http().get('/scheduled-expenses').expect(200);
      expect(list.body).toHaveLength(1);
      await http().delete(`/scheduled-expenses/${created.body.id}`).expect(204);
      expect((await http().get('/projection').query({ to: '2027-01-31' })).body.committed.amount).toBe('0');
    });

    it('rechaza horizontes > 24 meses, fechas pasadas y formatos inválidos con 400', async () => {
      await createAccounts();
      await http().get('/projection').query({ to: '2028-10-25' }).expect(400);
      await http().get('/projection').query({ to: '2026-10-01' }).expect(400);
      await http().get('/projection').query({ to: 'mañana' }).expect(400);
      await http().get('/projection').expect(400);
      await http().get('/projection').query({ to: '2028-10-24' }).expect(200);
    });

    it('liquidar con createTransactions crea los gastos reales y deja de comprometer ese tramo', async () => {
      const { bank } = await createAccounts();
      const { body } = await http()
        .post('/scheduled-expenses')
        .send({ description: 'Arriendo', amount: '800000', accountId: bank.id, frequency: 'MONTHLY', startDate: '2026-11-05' })
        .expect(201);

      const settled = await http()
        .post(`/scheduled-expenses/${body.id}/settle`)
        .send({ through: '2026-12-31', createTransactions: true })
        .expect(200);
      expect(settled.body.settledThrough).toBe('2026-12-31');

      const history = await http().get('/transactions').expect(200);
      expect(history.body.items.map((t: { date: string }) => t.date.slice(0, 10))).toEqual(['2026-12-05', '2026-11-05']);

      const summary = (await http().get('/summary')).body;
      expect(summary.netWorth.amount).toBe('500000'); // 2.100.000 − 2 × 800.000
      const projection = (await http().get('/projection').query({ to: '2027-01-31' })).body;
      expect(projection.committed.amount).toBe('800000'); // solo enero
      expect(projection.availableBalance.amount).toBe('-300000');

      await http().post(`/scheduled-expenses/${body.id}/settle`).send({ through: '2026-11-30' }).expect(422);
      await http().post('/scheduled-expenses/00000000-0000-4000-8000-000000000000/settle').send({ through: '2026-12-31' }).expect(404);
    });
  });

  describe('caché, invalidación y ETag', () => {
    it('INVALIDACIÓN: /summary cambia tras registrar una transacción', async () => {
      const { cash } = await createAccounts();
      expect((await http().get('/summary').expect(200)).body.netWorth.amount).toBe('2100000');
      expect((await http().get('/summary').expect(200)).body.netWorth.amount).toBe('2100000'); // desde caché
      await http().post('/transactions').send({ type: 'INCOME', accountId: cash.id, amount: '400000', description: 'Bono' }).expect(201);
      expect((await http().get('/summary').expect(200)).body.netWorth.amount).toBe('2500000');
    });

    it('INVALIDACIÓN: /projection cambia tras crear un gasto programado', async () => {
      const { bank } = await createAccounts();
      expect((await http().get('/projection').query({ to: '2026-12-31' })).body.committed.amount).toBe('0');
      await http()
        .post('/scheduled-expenses')
        .send({ description: 'Internet', amount: '100000', accountId: bank.id, frequency: 'ONCE', startDate: '2026-11-15' })
        .expect(201);
      expect((await http().get('/projection').query({ to: '2026-12-31' })).body.committed.amount).toBe('100000');
    });

    it('envía ETag y Cache-Control privado; responde 304 si coincide If-None-Match', async () => {
      const { cash } = await createAccounts();
      const first = await http().get('/summary').expect(200);
      expect(first.headers['cache-control']).toBe('private, no-cache');
      const etag = first.headers['etag'];
      expect(etag).toBeTruthy();

      const notModified = await http().get('/summary').set('If-None-Match', etag).expect(304);
      expect(notModified.headers['etag']).toBe(etag);
      expect(notModified.text).toBeFalsy();

      await http().post('/transactions').send({ type: 'INCOME', accountId: cash.id, amount: '1', description: 'x' }).expect(201);
      const changed = await http().get('/summary').set('If-None-Match', etag).expect(200);
      expect(changed.headers['etag']).not.toBe(etag);
    });

    it('/projection también soporta ETag y 304', async () => {
      await createAccounts();
      const first = await http().get('/projection').query({ to: '2026-12-31' }).expect(200);
      expect(first.headers['cache-control']).toBe('private, no-cache');
      await http().get('/projection').query({ to: '2026-12-31' }).set('If-None-Match', first.headers['etag']).expect(304);
    });
  });

  it('habilita CORS para http://localhost:3000', async () => {
    const res = await http().get('/accounts').set('Origin', 'http://localhost:3000').expect(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });
});
