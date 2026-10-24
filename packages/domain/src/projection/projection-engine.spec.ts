import { Account } from '../account/account';
import { BalanceCalculator } from '../ledger/balance-calculator';
import { Money } from '../money/money';
import { ScheduledExpense } from '../scheduled/scheduled-expense';
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
