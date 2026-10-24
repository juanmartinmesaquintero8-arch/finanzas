import { Account } from '../account/account';
import { Money } from '../money/money';
import { TransactionFactory } from '../transaction/transaction.factory';
import { BalanceCalculator, UnknownAccountError } from './balance-calculator';

const cop = (n: number) => Money.of(n, 'COP');
const d = (s: string) => new Date(`${s}T12:00:00Z`);

const accounts = [
  Account.create({ id: 'cash', name: 'Efectivo', type: 'CASH', initialBalance: cop(100_000) }),
  Account.create({ id: 'bancolombia', name: 'Bancolombia', type: 'BANK', initialBalance: cop(2_000_000) }),
  Account.create({ id: 'nu', name: 'Nu', type: 'DIGITAL', initialBalance: cop(0) }),
];

const txs = [
  TransactionFactory.create({ id: '1', type: 'INCOME', accountId: 'bancolombia', amount: cop(3_000_000), date: d('2026-10-01'), description: 'Salario' }),
  TransactionFactory.create({ id: '2', type: 'EXPENSE', accountId: 'cash', amount: cop(40_000), date: d('2026-10-02'), description: 'Almuerzo' }),
  TransactionFactory.create({ id: '3', type: 'TRANSFER', fromAccountId: 'bancolombia', toAccountId: 'nu', amount: cop(1_000_000), date: d('2026-10-03'), description: 'Ahorro' }),
  TransactionFactory.create({ id: '4', type: 'EXPENSE', accountId: 'nu', amount: cop(150_000), date: d('2026-10-20'), description: 'Internet' }),
];

describe('BalanceCalculator', () => {
  const calc = new BalanceCalculator('COP');

  it('calcula el saldo por cuenta a partir del saldo inicial y el ledger', () => {
    const result = calc.calculate(accounts, txs);
    expect(result.balanceOf('cash')).toEqual(cop(60_000));
    expect(result.balanceOf('bancolombia')).toEqual(cop(4_000_000));
    expect(result.balanceOf('nu')).toEqual(cop(850_000));
  });

  it('calcula el patrimonio total como suma de las cuentas', () => {
    expect(calc.calculate(accounts, txs).netWorth).toEqual(cop(4_910_000));
  });

  it('las transferencias no cambian el patrimonio', () => {
    expect(calc.calculate(accounts, [txs[2]]).netWorth).toEqual(cop(2_100_000));
  });

  it('puede calcular a una fecha de corte (inclusive)', () => {
    const result = calc.calculate(accounts, txs, d('2026-10-03'));
    expect(result.balanceOf('nu')).toEqual(cop(1_000_000));
    expect(result.netWorth).toEqual(cop(5_060_000));
  });

  it('lista los saldos en el orden de las cuentas', () => {
    expect(calc.calculate(accounts, []).balances.map((b) => b.accountId)).toEqual(['cash', 'bancolombia', 'nu']);
  });

  it('falla si una transacción referencia una cuenta inexistente', () => {
    const orphan = TransactionFactory.create({ id: 'x', type: 'INCOME', accountId: 'ghost', amount: cop(1), date: d('2026-10-01'), description: 'x' });
    expect(() => calc.calculate(accounts, [orphan])).toThrow(UnknownAccountError);
  });

  it('balanceOf de una cuenta desconocida falla', () => {
    expect(() => calc.calculate(accounts, []).balanceOf('ghost')).toThrow(UnknownAccountError);
  });
});
