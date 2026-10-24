import { Money } from '../money/money';
import { DomainValidationError } from '../shared/domain-validation.error';
import { TransactionFactory } from './transaction.factory';
import { ExpenseTransaction, IncomeTransaction, TransferTransaction } from './transaction';

const cop = (n: number) => Money.of(n, 'COP');
const date = new Date('2026-10-01T12:00:00Z');

describe('TransactionFactory', () => {
  it('crea un ingreso que suma a la cuenta', () => {
    const tx = TransactionFactory.create({
      id: 't1', type: 'INCOME', accountId: 'nu', amount: cop(500), date, description: 'Salario',
    });
    expect(tx).toBeInstanceOf(IncomeTransaction);
    expect(tx.effects()).toEqual([{ accountId: 'nu', delta: cop(500) }]);
  });

  it('crea un gasto que resta de la cuenta', () => {
    const tx = TransactionFactory.create({
      id: 't2', type: 'EXPENSE', accountId: 'cash', amount: cop(200), date, description: 'Mercado', category: 'Comida',
    });
    expect(tx).toBeInstanceOf(ExpenseTransaction);
    expect(tx.category).toBe('Comida');
    expect(tx.effects()).toEqual([{ accountId: 'cash', delta: cop(-200) }]);
  });

  it('crea una transferencia que mueve dinero sin alterar el total', () => {
    const tx = TransactionFactory.create({
      id: 't3', type: 'TRANSFER', fromAccountId: 'bancolombia', toAccountId: 'nu', amount: cop(300), date, description: 'Ahorro',
    });
    expect(tx).toBeInstanceOf(TransferTransaction);
    expect(tx.effects()).toEqual([
      { accountId: 'bancolombia', delta: cop(-300) },
      { accountId: 'nu', delta: cop(300) },
    ]);
    const total = tx.effects().reduce((acc, e) => acc.add(e.delta), Money.zero('COP'));
    expect(total.isZero()).toBe(true);
  });

  it('rechaza transferencias a la misma cuenta', () => {
    expect(() =>
      TransactionFactory.create({
        id: 't4', type: 'TRANSFER', fromAccountId: 'nu', toAccountId: 'nu', amount: cop(1), date, description: 'x',
      }),
    ).toThrow(DomainValidationError);
  });

  it.each([0, -10])('rechaza montos no positivos (%i)', (n) => {
    expect(() =>
      TransactionFactory.create({ id: 't5', type: 'EXPENSE', accountId: 'nu', amount: cop(n), date, description: 'x' }),
    ).toThrow(DomainValidationError);
  });

  it('rechaza fechas inválidas', () => {
    expect(() =>
      TransactionFactory.create({ id: 't6', type: 'INCOME', accountId: 'nu', amount: cop(1), date: new Date('nope'), description: 'x' }),
    ).toThrow(DomainValidationError);
  });

  it('expone las cuentas involucradas', () => {
    const tx = TransactionFactory.create({
      id: 't7', type: 'TRANSFER', fromAccountId: 'a', toAccountId: 'b', amount: cop(1), date, description: 'x',
    });
    expect(tx.accountIds()).toEqual(['a', 'b']);
  });
});
