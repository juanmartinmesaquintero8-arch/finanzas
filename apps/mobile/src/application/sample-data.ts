import { Account, CardPurchase, CreditCard, InterestRate, Money, ScheduledExpense, ScheduledIncome, TransactionFactory, firstDueDateFor } from '@finanzas/domain';
import { addDays, addMonthsISO, todayISO } from '@finanzas/ui';
import type { LedgerSnapshot } from '@/data/idb-ledger-store';
import { CURRENCY, parseDay } from './support';

/** Todo lo de ejemplo lleva este prefijo en el id: así se puede borrar sin tocar lo propio. */
export const SAMPLE_PREFIX = 'demo-';

const cop = (n: number) => Money.of(n, CURRENCY);

/** Datos de ejemplo (como los de la versión de escritorio), fechados respecto a hoy. */
export function generateSampleData(now: Date): LedgerSnapshot {
  const today = todayISO(now);
  const ago = (days: number) => parseDay(addDays(today, -days));
  const nextMonth5th = (() => {
    const first = addMonthsISO(`${today.slice(0, 7)}-01`, 1);
    return parseDay(`${first.slice(0, 8)}05`);
  })();

  const accounts = [
    Account.create({ id: `${SAMPLE_PREFIX}efectivo`, name: 'Efectivo', type: 'CASH', initialBalance: cop(200_000) }),
    Account.create({ id: `${SAMPLE_PREFIX}bancolombia`, name: 'Bancolombia', type: 'BANK', initialBalance: cop(3_000_000) }),
    Account.create({ id: `${SAMPLE_PREFIX}nu`, name: 'Nu', type: 'DIGITAL', initialBalance: cop(800_000) }),
  ];

  const tx = (n: number, input: Parameters<typeof TransactionFactory.create>[0]) => TransactionFactory.create({ ...input, id: `${SAMPLE_PREFIX}t${n}` });
  const transactions = [
    tx(1, { type: 'INCOME', id: '', accountId: `${SAMPLE_PREFIX}bancolombia`, amount: cop(2_500_000), date: ago(4), description: 'Nómina', category: 'Salario' }),
    tx(2, { type: 'EXPENSE', id: '', accountId: `${SAMPLE_PREFIX}efectivo`, amount: cop(85_000), date: ago(2), description: 'Mercado', category: 'Mercado' }),
    tx(3, { type: 'TRANSFER', id: '', fromAccountId: `${SAMPLE_PREFIX}bancolombia`, toAccountId: `${SAMPLE_PREFIX}nu`, amount: cop(300_000), date: ago(1), description: 'Ahorro del mes' }),
    tx(4, { type: 'EXPENSE', id: '', accountId: `${SAMPLE_PREFIX}nu`, amount: cop(32_000), date: ago(1), description: 'Almuerzo', category: 'Comida' }),
    tx(5, { type: 'EXPENSE', id: '', accountId: `${SAMPLE_PREFIX}efectivo`, amount: cop(12_000), date: ago(0), description: 'Transporte', category: 'Transporte' }),
    tx(6, { type: 'EXPENSE', id: '', accountId: `${SAMPLE_PREFIX}bancolombia`, amount: cop(120_000), date: ago(9), description: 'Servicios del hogar', category: 'Servicios' }),
  ];

  const scheduledExpenses = [
    ScheduledExpense.create({ id: `${SAMPLE_PREFIX}arriendo`, description: 'Arriendo', amount: cop(1_200_000), accountId: `${SAMPLE_PREFIX}bancolombia`, frequency: 'MONTHLY', startDate: nextMonth5th }),
    ScheduledExpense.create({ id: `${SAMPLE_PREFIX}internet`, description: 'Internet', amount: cop(90_000), accountId: `${SAMPLE_PREFIX}nu`, frequency: 'MONTHLY', startDate: parseDay(addDays(today, 10)) }),
  ];

  const scheduledIncomes = [
    ScheduledIncome.create({ id: `${SAMPLE_PREFIX}sueldo`, description: 'Sueldo', amount: cop(2_500_000), accountId: `${SAMPLE_PREFIX}bancolombia`, frequency: 'MONTHLY', startDate: parseDay(addDays(today, 12)), category: 'Salario' }),
  ];

  const rate = InterestRate.create({ basis: 'MV', ppm: 18_700 });
  const card = CreditCard.create({
    id: `${SAMPLE_PREFIX}visa`,
    name: 'Visa de ejemplo',
    dueDay: 15,
    cutDay: 5,
    paymentAccountId: `${SAMPLE_PREFIX}bancolombia`,
    fee: { kind: 'FIXED_MONTHLY', amount: cop(18_000) },
    rate,
    feeStartMonth: today.slice(0, 7),
  });
  const purchaseDate = parseDay(today);
  const purchase = CardPurchase.create({
    id: `${SAMPLE_PREFIX}televisor`,
    cardId: card.id,
    description: 'Televisor',
    category: 'Hogar',
    amount: cop(1_200_000),
    installments: 12,
    purchaseDate,
    firstDueDate: firstDueDateFor(purchaseDate, card.dueDay, card.cutDay),
    monthlyRatePpm: rate.monthlyPpm,
    paidInstallments: 0,
    dueDayAnchor: card.dueDay,
  });

  return { accounts, transactions, scheduledExpenses, scheduledIncomes, creditCards: [card], cardPurchases: [purchase], cardPayments: [] };
}

export const isSampleId = (id: string): boolean => id.startsWith(SAMPLE_PREFIX);

/** Pago hecho a una compra o tarjeta de ejemplo, o parte de un pago de ejemplo: `cp-demo-…`, `ci-demo-…`, `cf-demo-…`, `pt-demo-…`. */
export const isSampleCardPaymentId = (id: string): boolean => /^(cp|ci|cf|pt)-/.test(id) && isSampleId(id.slice(3));
