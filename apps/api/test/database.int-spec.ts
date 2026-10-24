import { PrismaClient } from '@prisma/client';
import { TEST_DATABASE_URL } from './global-setup';

describe('Base de datos (integración)', () => {
  const prisma = new PrismaClient({ datasourceUrl: TEST_DATABASE_URL });

  afterAll(() => prisma.$disconnect());

  it('conecta con PostgreSQL', async () => {
    const [row] = await prisma.$queryRaw<{ ok: number }[]>`SELECT 1::int AS ok`;
    expect(row.ok).toBe(1);
  });

  it('tiene las tablas del modelo', async () => {
    const rows = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
    const tables = rows.map((r) => r.table_name);
    expect(tables).toEqual(expect.arrayContaining(['accounts', 'transactions', 'scheduled_expenses']));
  });

  it('tiene los índices de rendimiento exigidos por CLAUDE.md §7.2', async () => {
    const rows = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE schemaname = 'public'`;
    const defs = rows.map((r) => r.indexdef.replace(/"/g, ''));
    const expectIndex = (table: string, cols: string) =>
      expect(defs.some((d) => d.includes(`ON public.${table}`) && d.includes(`(${cols})`))).toBe(true);

    expectIndex('transactions', 'account_id, date');
    expectIndex('transactions', 'from_account_id');
    expectIndex('transactions', 'to_account_id');
    expectIndex('transactions', 'date DESC, id');
    expectIndex('scheduled_expenses', 'account_id');
  });

  it('impide montos no positivos a nivel de BD (CHECK)', async () => {
    const account = await prisma.account.create({
      data: { name: 'Check', type: 'CASH', currency: 'COP', initialBalance: 0n },
    });
    await expect(
      prisma.transaction.create({
        data: { type: 'EXPENSE', amount: 0n, currency: 'COP', date: new Date(), description: 'x', accountId: account.id },
      }),
    ).rejects.toThrow();
    await prisma.account.delete({ where: { id: account.id } });
  });
});
