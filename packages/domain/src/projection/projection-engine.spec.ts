import { Account } from '../account/account';
import { BalanceCalculator, BalanceSnapshot } from '../ledger/balance-calculator';
import { Money } from '../money/money';
import { ScheduledExpense } from '../scheduled/scheduled-expense';
import { ScheduledIncome } from '../scheduled/scheduled-income';
import { TransactionFactory } from '../transaction/transaction.factory';
import { ProjectionEngine } from './projection-engine';

const cop = (n: number) => Money.of(n, 'COP');
const d = (s: string) => new Date(`${s}T00:00:00Z`);

const accounts = [
  Account.create({ id: 'cash', name: 'Efectivo', type: 'CASH', initialBalance: cop(200_000) }),
  Account.create({ id: 'bancolombia', name: 'Bancolombia', type: 'BANK', initialBalance: cop(3_000_000) }),
  Account.create({ id: 'nu', name: 'Nu', type: 'DIGITAL', initialBalance: cop(800_000) }),
];
const snapshot = new BalanceCalculator('COP').calculate(accounts, [
  TransactionFactory.create({ id: 't', type: 'EXPENSE', accountId: 'cash', amount: cop(50_000), date: d('2026-10-10'), description: 'Taxi' }),
]);
// Patrimonio: 150.000 + 3.000.000 + 800.000 = 3.950.000

const scheduled = [
  ScheduledExpense.create({ id: 'arriendo', description: 'Arriendo', amount: cop(1_200_000), accountId: 'bancolombia', frequency: 'MONTHLY', startDate: d('2026-01-05') }),
  ScheduledExpense.create({ id: 'netflix', description: 'Netflix', amount: cop(40_000), accountId: 'nu', frequency: 'MONTHLY', startDate: d('2026-03-28') }),
  ScheduledExpense.create({ id: 'soat', description: 'SOAT', amount: cop(500_000), accountId: 'bancolombia', frequency: 'ONCE', startDate: d('2027-02-01') }),
];

describe('ProjectionEngine', () => {
  const engine = new ProjectionEngine('COP');
  const from = d('2026-10-24');
  const to = d('2026-11-30');
  const projection = engine.project({ snapshot, scheduledExpenses: scheduled, from, to });

  it('lista los compromisos pendientes ordenados por fecha', () => {
    expect(projection.commitments.map((c) => [c.scheduledExpenseId, c.date.toISOString().slice(0, 10)])).toEqual([
      ['netflix', '2026-10-28'],
      ['arriendo', '2026-11-05'],
      ['netflix', '2026-11-28'],
    ]);
  });

  it('suma el total comprometido', () => {
    expect(projection.committed).toEqual(cop(1_280_000));
  });

  it('Saldo Real Disponible = patrimonio − compromisos', () => {
    expect(projection.netWorth).toEqual(cop(3_950_000));
    expect(projection.availableBalance).toEqual(cop(2_670_000));
  });

  it('desglosa el disponible por cuenta', () => {
    const byId = Object.fromEntries(projection.accounts.map((a) => [a.accountId, a]));
    expect(byId.bancolombia.committed).toEqual(cop(1_200_000));
    expect(byId.bancolombia.available).toEqual(cop(1_800_000));
    expect(byId.nu.available).toEqual(cop(720_000));
    expect(byId.cash.committed).toEqual(cop(0));
  });

  it('genera una línea de tiempo del saldo proyectado tras cada compromiso', () => {
    expect(projection.timeline.map((p) => [p.date.toISOString().slice(0, 10), p.balance.amount])).toEqual([
      ['2026-10-24', 3_950_000n],
      ['2026-10-28', 3_910_000n],
      ['2026-11-05', 2_710_000n],
      ['2026-11-28', 2_670_000n],
    ]);
  });

  it('alerta cuando el disponible queda negativo', () => {
    const p = engine.project({
      snapshot,
      scheduledExpenses: [ScheduledExpense.create({ id: 'x', description: 'Viaje', amount: cop(5_000_000), accountId: 'nu', frequency: 'ONCE', startDate: d('2026-11-01') })],
      from,
      to,
    });
    expect(p.availableBalance.isNegative()).toBe(true);
    expect(p.isShortfall).toBe(true);
    expect(projection.isShortfall).toBe(false);
  });

  it('sin gastos programados el disponible es igual al patrimonio', () => {
    const p = engine.project({ snapshot, scheduledExpenses: [], from, to });
    expect(p.availableBalance).toEqual(p.netWorth);
    expect(p.timeline).toHaveLength(1);
  });
});

describe('ProjectionEngine con ingresos programados', () => {
  const engine = new ProjectionEngine('COP');
  const from = d('2026-10-24');
  const to = d('2026-11-30');
  const income = (id: string, amount: number, startDate: string, over: Partial<Parameters<typeof ScheduledIncome.create>[0]> = {}) =>
    ScheduledIncome.create({ id, description: id, amount: cop(amount), accountId: 'bancolombia', frequency: 'MONTHLY', startDate: d(startDate), ...over });
  const cash = (n: number) => new BalanceSnapshot([], cop(n));
  const expense = (id: string, amount: number, on: string) =>
    ScheduledExpense.create({ id, description: id, amount: cop(amount), accountId: 'bancolombia', frequency: 'ONCE', startDate: d(on) });
  const day = (p: { date: Date }) => p.date.toISOString().slice(0, 10);

  it('con y sin ingresos, lo que ya existía no cambia ni un dato', () => {
    const without = engine.project({ snapshot, scheduledExpenses: scheduled, from, to });
    const withIncome = engine.project({
      snapshot,
      scheduledExpenses: scheduled,
      scheduledIncomes: [income('sueldo', 2_000_000, '2026-10-30'), income('extra', 77, '2026-11-02', { frequency: 'ONCE' })],
      from,
      to,
    });
    expect(withIncome.availableBalance).toEqual(without.availableBalance);
    expect(withIncome.committed).toEqual(without.committed);
    expect(withIncome.isShortfall).toEqual(without.isShortfall);
    expect(withIncome.commitments).toEqual(without.commitments);
    expect(withIncome.timeline).toEqual(without.timeline);
    expect(withIncome.netWorth).toEqual(without.netWorth);
    expect(withIncome.accounts).toEqual(without.accounts);
  });

  it('un ingreso esperado nunca arregla un déficit del Saldo Real', () => {
    const p = engine.project({
      snapshot: cash(100),
      scheduledExpenses: [expense('viaje', 500, '2026-11-05')],
      scheduledIncomes: [income('sueldo', 10_000, '2026-11-30', { frequency: 'ONCE' })],
      from,
      to,
    });
    expect(p.availableBalance).toEqual(cop(-400));
    expect(p.isShortfall).toBe(true);
    expect(p.expectedIncome).toEqual(cop(10_000));
    expect(p.availableWithIncome).toEqual(cop(9_600));
  });

  it('suma los ingresos esperados hasta la fecha de corte', () => {
    const p = engine.project({ snapshot, scheduledExpenses: scheduled, scheduledIncomes: [income('sueldo', 2_000_000, '2026-10-30')], from, to });
    expect(p.expectedIncome).toEqual(cop(4_000_000));
    expect(p.availableWithIncome).toEqual(cop(6_670_000));
  });

  it('sin ingresos: nada esperado, y el punto más bajo es el del propio disponible', () => {
    const p = engine.project({ snapshot, scheduledExpenses: scheduled, from, to });
    expect(p.expectedIncome).toEqual(cop(0));
    expect(p.availableWithIncome).toEqual(p.availableBalance);
    expect(day(p.lowestWithIncome)).toBe('2026-11-28');
    expect(p.lowestWithIncome.balance).toEqual(cop(2_670_000));
  });

  it('sueldo el 30 y gasto el 5: el punto más bajo es negativo aunque el total sea positivo', () => {
    const p = engine.project({
      snapshot: cash(100),
      scheduledExpenses: [expense('arriendo', 500, '2026-11-05')],
      scheduledIncomes: [income('sueldo', 1_000, '2026-11-30', { frequency: 'ONCE' })],
      from,
      to,
    });
    expect(p.availableWithIncome).toEqual(cop(600));
    expect(day(p.lowestWithIncome)).toBe('2026-11-05');
    expect(p.lowestWithIncome.balance).toEqual(cop(-400));
  });

  it('el mismo día, el ingreso se aplica antes que el gasto', () => {
    const p = engine.project({
      snapshot: cash(100),
      scheduledExpenses: [expense('arriendo', 350, '2026-11-05')],
      scheduledIncomes: [income('sueldo', 300, '2026-11-05', { frequency: 'ONCE' })],
      from,
      to,
    });
    expect(day(p.lowestWithIncome)).toBe('2026-11-05');
    expect(p.lowestWithIncome.balance).toEqual(cop(50));
  });

  it('en empate gana el primer día', () => {
    const p = engine.project({
      snapshot: cash(100),
      scheduledExpenses: [expense('a', 100, '2026-11-05'), expense('b', 100, '2026-11-15')],
      scheduledIncomes: [income('i', 100, '2026-11-10', { frequency: 'ONCE' })],
      from,
      to,
    });
    expect(day(p.lowestWithIncome)).toBe('2026-11-05');
    expect(p.lowestWithIncome.balance).toEqual(cop(0));
  });

  it('si nada baja del saldo de hoy, el punto más bajo es hoy', () => {
    const p = engine.project({ snapshot: cash(100), scheduledExpenses: [], scheduledIncomes: [income('i', 50, '2026-11-10', { frequency: 'ONCE' })], from, to });
    expect(day(p.lowestWithIncome)).toBe('2026-10-24');
    expect(p.lowestWithIncome.balance).toEqual(cop(100));
  });

  it('un ingreso vencido sin recibir no cuenta', () => {
    const p = engine.project({
      snapshot: cash(100),
      scheduledExpenses: [],
      scheduledIncomes: [income('viejo', 999, '2026-09-30', { endDate: d('2026-10-01') }), income('unico', 999, '2026-10-20', { frequency: 'ONCE' })],
      from,
      to,
    });
    expect(p.expectedIncome).toEqual(cop(0));
    expect(p.availableWithIncome).toEqual(cop(100));
  });

  it('respeta lo ya recibido (settledThrough)', () => {
    const p = engine.project({ snapshot: cash(0), scheduledExpenses: [], scheduledIncomes: [income('sueldo', 100, '2026-10-30', { settledThrough: d('2026-10-30') })], from, to });
    expect(p.expectedIncome).toEqual(cop(100));
  });
});

describe('ProjectionEngine: fecha del último ingreso esperado', () => {
  const engine = new ProjectionEngine('COP');
  const from = d('2026-10-24');
  const to = d('2026-11-30');
  const inc = (id: string, on: string, over = {}) =>
    ScheduledIncome.create({ id, description: id, amount: cop(10), accountId: 'a', frequency: 'ONCE', startDate: d(on), ...over });
  const snap = new BalanceSnapshot([], cop(100));

  it('es la fecha del último ingreso que cae en la ventana', () => {
    const p = engine.project({ snapshot: snap, scheduledExpenses: [], scheduledIncomes: [inc('a', '2026-11-05'), inc('b', '2026-11-20'), inc('c', '2027-01-01')], from, to });
    expect(p.lastExpectedIncomeDate?.toISOString().slice(0, 10)).toBe('2026-11-20');
  });

  it('con ingresos recurrentes es la última ocurrencia dentro de la ventana', () => {
    const p = engine.project({ snapshot: snap, scheduledExpenses: [], scheduledIncomes: [inc('m', '2026-10-30', { frequency: 'MONTHLY' })], from, to });
    expect(p.lastExpectedIncomeDate?.toISOString().slice(0, 10)).toBe('2026-11-30');
  });

  it('sin ingresos esperados no hay fecha', () => {
    const p = engine.project({ snapshot: snap, scheduledExpenses: [], from, to });
    expect(p.lastExpectedIncomeDate).toBeUndefined();
  });
});

describe('ProjectionEngine con compromisos extra (tarjetas)', () => {
  const engine = new ProjectionEngine('COP');
  const from = d('2026-10-24');
  const to = d('2026-11-30');
  const base = { snapshot, scheduledExpenses: scheduled, from, to };
  const extra = [
    { scheduledExpenseId: 'p1', kind: 'CARD_INSTALLMENT' as const, description: 'Nevera (1/3)', accountId: 'nu', date: d('2026-10-30'), amount: cop(100_000) },
    { scheduledExpenseId: 'c1', kind: 'CARD_FEE' as const, description: 'Manejo Visa', accountId: 'bancolombia', date: d('2026-11-05'), amount: cop(30_000) },
  ];

  it('sin extraCommitments el resultado es idéntico al de siempre (también con arreglo vacío)', () => {
    const plain = engine.project(base);
    expect(JSON.stringify(engine.project({ ...base, extraCommitments: [] }))).toBe(JSON.stringify(plain));
    expect(engine.project({ ...base, extraCommitments: undefined })).toStrictEqual(plain);
    expect(plain.commitments.every((c) => !('kind' in c))).toBe(true);
  });

  it('entra en committed, disponible, faltante, compromisos y por cuenta', () => {
    const p = engine.project({ ...base, extraCommitments: extra });
    expect(p.committed).toEqual(cop(1_410_000));
    expect(p.availableBalance).toEqual(cop(2_540_000));
    expect(p.commitments).toHaveLength(5);
    expect(p.commitments.map((c) => c.date.getTime())).toEqual([...p.commitments.map((c) => c.date.getTime())].sort((a, b) => a - b));
    expect(p.commitments.find((c) => c.scheduledExpenseId === 'p1')?.kind).toBe('CARD_INSTALLMENT');
    const byId = Object.fromEntries(p.accounts.map((a) => [a.accountId, a]));
    expect(byId.nu.committed).toEqual(cop(180_000));
    expect(byId.bancolombia.committed).toEqual(cop(1_230_000));
  });

  it('entra en la línea de tiempo y en el punto más bajo con ingresos', () => {
    const income = ScheduledIncome.create({ id: 'i', description: 'Sueldo', amount: cop(500_000), accountId: 'nu', frequency: 'ONCE', startDate: d('2026-11-20') });
    const p = engine.project({ ...base, scheduledIncomes: [income], extraCommitments: extra });
    expect(p.timeline.map((t) => [t.date.toISOString().slice(0, 10), t.balance.amount])).toEqual([
      ['2026-10-24', 3_950_000n],
      ['2026-10-28', 3_910_000n],
      ['2026-10-30', 3_810_000n],
      ['2026-11-05', 2_580_000n],
      ['2026-11-28', 2_540_000n],
    ]);
    expect(p.lowestWithIncome.balance).toEqual(cop(2_580_000));
  });

  it('un faltante por tarjeta se marca como faltante', () => {
    const big = [{ scheduledExpenseId: 'p9', kind: 'CARD_INSTALLMENT' as const, description: 'Carro', accountId: 'nu', date: d('2026-11-01'), amount: cop(9_000_000) }];
    expect(engine.project({ ...base, extraCommitments: big }).isShortfall).toBe(true);
    expect(engine.project(base).isShortfall).toBe(false);
  });
});
