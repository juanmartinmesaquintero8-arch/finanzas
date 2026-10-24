import { Money } from '../money/money';
import { assertDomain } from '../shared/domain-validation.error';

export const TRANSACTION_TYPES = ['INCOME', 'EXPENSE', 'TRANSFER'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

/** Variación que una transacción produce sobre el saldo de una cuenta. */
export interface BalanceEffect {
  accountId: string;
  delta: Money;
}

interface BaseProps {
  id: string;
  amount: Money;
  date: Date;
  description: string;
  category?: string;
}

/**
 * Transacción del ledger. Cada subtipo define sus propios efectos sobre las cuentas
 * (polimorfismo: agregar un tipo nuevo no obliga a modificar el cálculo de saldos).
 */
export abstract class Transaction {
  abstract readonly type: TransactionType;
  readonly id: string;
  readonly amount: Money;
  readonly date: Date;
  readonly description: string;
  readonly category?: string;

  protected constructor(props: BaseProps) {
    assertDomain(props.amount.isPositive(), 'El monto debe ser mayor que cero');
    assertDomain(!Number.isNaN(props.date.getTime()), 'La fecha de la transacción es inválida');
    this.id = props.id;
    this.amount = props.amount;
    this.date = props.date;
    this.description = props.description.trim();
    this.category = props.category?.trim() || undefined;
  }

  abstract effects(): BalanceEffect[];

  accountIds(): string[] {
    return this.effects().map((e) => e.accountId);
  }
}

export class IncomeTransaction extends Transaction {
  readonly type = 'INCOME' as const;
  readonly accountId: string;

  constructor(props: BaseProps & { accountId: string }) {
    super(props);
    this.accountId = props.accountId;
  }

  effects(): BalanceEffect[] {
    return [{ accountId: this.accountId, delta: this.amount }];
  }
}

export class ExpenseTransaction extends Transaction {
  readonly type = 'EXPENSE' as const;
  readonly accountId: string;

  constructor(props: BaseProps & { accountId: string }) {
    super(props);
    this.accountId = props.accountId;
  }

  effects(): BalanceEffect[] {
    return [{ accountId: this.accountId, delta: this.amount.negate() }];
  }
}

export class TransferTransaction extends Transaction {
  readonly type = 'TRANSFER' as const;
  readonly fromAccountId: string;
  readonly toAccountId: string;

  constructor(props: BaseProps & { fromAccountId: string; toAccountId: string }) {
    super(props);
    assertDomain(props.fromAccountId !== props.toAccountId, 'La cuenta origen y destino deben ser distintas');
    this.fromAccountId = props.fromAccountId;
    this.toAccountId = props.toAccountId;
  }

  effects(): BalanceEffect[] {
    return [
      { accountId: this.fromAccountId, delta: this.amount.negate() },
      { accountId: this.toAccountId, delta: this.amount },
    ];
  }
}
