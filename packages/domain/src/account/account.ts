import { Money } from '../money/money';
import { assertDomain } from '../shared/domain-validation.error';

export const ACCOUNT_TYPES = ['CASH', 'BANK', 'DIGITAL', 'SAVINGS', 'CREDIT'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export interface AccountProps {
  id: string;
  name: string;
  type: AccountType;
  initialBalance: Money;
}

/** Cuenta donde vive el dinero (Efectivo, Bancolombia, Nu…). Su saldo se deriva del ledger. */
export class Account {
  private constructor(
    readonly id: string,
    readonly name: string,
    readonly type: AccountType,
    readonly initialBalance: Money,
  ) {}

  static create(props: AccountProps): Account {
    const name = props.name.trim();
    assertDomain(name.length > 0, 'El nombre de la cuenta es obligatorio');
    assertDomain(ACCOUNT_TYPES.includes(props.type), `Tipo de cuenta inválido: ${props.type}`);
    return new Account(props.id, name, props.type, props.initialBalance);
  }

  get currency(): string {
    return this.initialBalance.currency;
  }
}
