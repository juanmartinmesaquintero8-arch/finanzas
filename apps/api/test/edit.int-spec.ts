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

describe('API de edición (integración contra finanzas_test)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let cache: CachePort;
  const http = () => request(app.getHttpServer());
  const MISSING = '00000000-0000-4000-8000-000000000000';

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
    };
  }

  const netWorth = async () => (await http().get('/summary').expect(200)).body.netWorth.amount as string;

  describe('transacciones', () => {
    it('GET /transactions/:id devuelve la transacción; 404 si no existe; 400 si el id es inválido', async () => {
      const { cash } = await createAccounts();
      const tx = await http().post('/transactions').send({ type: 'EXPENSE', accountId: cash.id, amount: '500', description: 'Pan' }).expect(201);
      const got = await http().get(`/transactions/${tx.body.id}`).expect(200);
      expect(got.body).toMatchObject({ id: tx.body.id, description: 'Pan', type: 'EXPENSE' });
      await http().get(`/transactions/${MISSING}`).expect(404);
      await http().get('/transactions/no-es-uuid').expect(400);
    });

    it('PUT /transactions/:id edita el movimiento y devuelve 200 con el cambio persistido', async () => {
      const { cash } = await createAccounts();
      const tx = await http().post('/transactions').send({ type: 'EXPENSE', accountId: cash.id, amount: '500', description: 'Pan' }).expect(201);
      const put = await http()
        .put(`/transactions/${tx.body.id}`)
        .send({ type: 'EXPENSE', accountId: cash.id, amount: '800', description: 'Pan y leche', category: 'Mercado', date: '2026-10-20T10:00:00Z' })
        .expect(200);
      expect(put.body).toMatchObject({ id: tx.body.id, amount: { amount: '800' }, description: 'Pan y leche', category: 'Mercado' });
      const got = await http().get(`/transactions/${tx.body.id}`).expect(200);
      expect(got.body).toMatchObject({ amount: { amount: '800' }, date: '2026-10-20T10:00:00.000Z' });
      expect((await http().get('/transactions').expect(200)).body.items).toHaveLength(1);
    });

    it('INVALIDACIÓN: /summary refleja el nuevo saldo tras editar monto, cuenta y tipo', async () => {
      const { cash, bank } = await createAccounts();
      const tx = await http().post('/transactions').send({ type: 'EXPENSE', accountId: cash.id, amount: '1000', description: 'x' }).expect(201);
      expect(await netWorth()).toBe('2099000');
      expect(await netWorth()).toBe('2099000'); // desde caché

      await http().put(`/transactions/${tx.body.id}`).send({ type: 'EXPENSE', accountId: cash.id, amount: '4000', description: 'x' }).expect(200);
      expect(await netWorth()).toBe('2096000');

      await http().put(`/transactions/${tx.body.id}`).send({ type: 'INCOME', accountId: bank.id, amount: '4000', description: 'x' }).expect(200);
      expect(await netWorth()).toBe('2104000');
      const summary = (await http().get('/summary')).body.accounts as { accountId: string; balance: { amount: string } }[];
      expect(summary.find((a) => a.accountId === bank.id)!.balance.amount).toBe('2004000');
      expect(summary.find((a) => a.accountId === cash.id)!.balance.amount).toBe('100000');

      await http()
        .put(`/transactions/${tx.body.id}`)
        .send({ type: 'TRANSFER', fromAccountId: cash.id, toAccountId: bank.id, amount: '4000', description: 'x' })
        .expect(200);
      expect(await netWorth()).toBe('2100000');
    });

    it('PUT: 404 si no existe, 404 si la cuenta no existe, 422 si viola una invariante, 400 si el cuerpo es inválido', async () => {
      const { cash } = await createAccounts();
      const tx = await http().post('/transactions').send({ type: 'INCOME', accountId: cash.id, amount: '5', description: 'x' }).expect(201);
      const body = { type: 'INCOME', accountId: cash.id, amount: '5', description: 'x' };
      await http().put(`/transactions/${MISSING}`).send(body).expect(404);
      await http().put(`/transactions/${tx.body.id}`).send({ ...body, accountId: MISSING }).expect(404);
      await http().put(`/transactions/${tx.body.id}`).send({ ...body, amount: '0' }).expect(422);
      await http().put(`/transactions/${tx.body.id}`).send({ ...body, type: 'BOGUS' }).expect(400);
      expect(await netWorth()).toBe('2100005');
    });
  });

  describe('cuentas', () => {
    it('PATCH /accounts/:id edita nombre, tipo y saldo inicial, e invalida el resumen', async () => {
      const { cash } = await createAccounts();
      expect(await netWorth()).toBe('2100000');
      const res = await http().patch(`/accounts/${cash.id}`).send({ name: 'Billetera', type: 'DIGITAL', initialBalance: '300000' }).expect(200);
      expect(res.body).toMatchObject({ id: cash.id, name: 'Billetera', type: 'DIGITAL', initialBalance: { amount: '300000' } });
      expect(await netWorth()).toBe('2300000');
      const got = await http().get(`/accounts/${cash.id}`).expect(200);
      expect(got.body.name).toBe('Billetera');
    });

    it('PATCH: parcial conserva lo demás; 404 si no existe; 400/422 si es inválido', async () => {
      const { cash } = await createAccounts();
      const res = await http().patch(`/accounts/${cash.id}`).send({ name: 'Solo nombre' }).expect(200);
      expect(res.body).toMatchObject({ name: 'Solo nombre', type: 'CASH', initialBalance: { amount: '100000' } });
      await http().patch(`/accounts/${MISSING}`).send({ name: 'x' }).expect(404);
      await http().patch(`/accounts/${cash.id}`).send({ type: 'NOPE' }).expect(400);
      await http().patch(`/accounts/${cash.id}`).send({ initialBalance: '1.5' }).expect(400);
      await http().patch(`/accounts/${cash.id}`).send({ name: '   ' }).expect(422);
    });
  });

  describe('gastos programados', () => {
    const base = (accountId: string) => ({
      description: 'Internet',
      amount: '100000',
      accountId,
      frequency: 'ONCE',
      startDate: '2026-11-15',
    });

    it('PUT /scheduled-expenses/:id edita el gasto e INVALIDA la proyección', async () => {
      const { bank } = await createAccounts();
      const exp = await http().post('/scheduled-expenses').send(base(bank.id)).expect(201);
      expect((await http().get('/projection').query({ to: '2026-12-31' })).body.committed.amount).toBe('100000');
      const put = await http()
        .put(`/scheduled-expenses/${exp.body.id}`)
        .send({ ...base(bank.id), description: 'Internet fibra', amount: '150000' })
        .expect(200);
      expect(put.body).toMatchObject({ id: exp.body.id, description: 'Internet fibra', amount: { amount: '150000' } });
      expect((await http().get('/projection').query({ to: '2026-12-31' })).body.committed.amount).toBe('150000');
      expect((await http().get('/scheduled-expenses').expect(200)).body).toHaveLength(1);
    });

    it('PUT: 404 si no existe o la cuenta no existe; 422 por invariantes; 400 por cuerpo inválido', async () => {
      const { bank } = await createAccounts();
      const exp = await http().post('/scheduled-expenses').send(base(bank.id)).expect(201);
      await http().put(`/scheduled-expenses/${MISSING}`).send(base(bank.id)).expect(404);
      await http().put(`/scheduled-expenses/${exp.body.id}`).send(base(MISSING)).expect(404);
      await http().put(`/scheduled-expenses/${exp.body.id}`).send({ ...base(bank.id), amount: '0' }).expect(422);
      await http().put(`/scheduled-expenses/${exp.body.id}`).send({ ...base(bank.id), frequency: 'NUNCA' }).expect(400);
    });
  });
});
