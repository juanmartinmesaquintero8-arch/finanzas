// Carga datos de ejemplo en la BD de desarrollo (solo si no hay cuentas).
// Uso desde la raíz: pnpm db:seed
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const today = new Date();
const daysAgo = (n) => new Date(today.getTime() - n * 86_400_000);
const day = (y, m, d) => new Date(Date.UTC(y, m - 1, d));

if ((await prisma.account.count()) > 0) {
  console.log('Ya hay cuentas: no se cargan datos de ejemplo.');
} else {
  const [cash, bancolombia, nu] = await Promise.all([
    prisma.account.create({ data: { name: 'Efectivo', type: 'CASH', currency: 'COP', initialBalance: 200_000n } }),
    prisma.account.create({ data: { name: 'Bancolombia', type: 'BANK', currency: 'COP', initialBalance: 3_000_000n } }),
    prisma.account.create({ data: { name: 'Nu', type: 'DIGITAL', currency: 'COP', initialBalance: 800_000n } }),
  ]);

  await prisma.transaction.createMany({
    data: [
      { type: 'INCOME', amount: 2_500_000n, currency: 'COP', date: daysAgo(4), description: 'Nómina 💰', category: 'Salario', accountId: bancolombia.id },
      { type: 'EXPENSE', amount: 85_000n, currency: 'COP', date: daysAgo(2), description: 'Mercado 🛒', category: 'Comida', accountId: cash.id },
      { type: 'TRANSFER', amount: 300_000n, currency: 'COP', date: daysAgo(1), description: 'Ahorro del mes', fromAccountId: bancolombia.id, toAccountId: nu.id },
    ],
  });

  await prisma.scheduledExpense.createMany({
    data: [
      { description: 'Arriendo 🏠', amount: 1_200_000n, currency: 'COP', accountId: bancolombia.id, frequency: 'MONTHLY', startDate: day(today.getUTCFullYear(), today.getUTCMonth() + 2, 5) },
      { description: 'Internet', amount: 90_000n, currency: 'COP', accountId: nu.id, frequency: 'MONTHLY', startDate: day(2026, 10, 28) },
    ],
  });

  console.log('Datos de ejemplo cargados: Efectivo, Bancolombia y Nu, 3 movimientos y 2 gastos programados.');
}

await prisma.$disconnect();
