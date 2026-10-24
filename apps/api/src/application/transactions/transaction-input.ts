import {
  AccountRepository,
  CreateTransactionInput as FactoryInput,
  DomainValidationError,
  TransactionType,
  UnknownAccountError,
  assertDomain,
} from '@finanzas/domain';
import { DEFAULT_CURRENCY } from '../config';
import { parseMoney } from '../money-parser';

/** Cuerpo para crear o reemplazar una transacción (mismo contrato en POST y PUT). */
export interface TransactionCommand {
  type: TransactionType;
  amount: string;
  currency?: string;
  /** ISO 8601; si falta, el llamador decide el valor por defecto. */
  date?: string;
  description: string;
  category?: string;
  accountId?: string;
  fromAccountId?: string;
  toAccountId?: string;
}

/** Traduce el comando a la entrada de la Factory, validando que lleve las cuentas que su tipo exige. */
export function toFactoryInput(id: string, date: Date, command: TransactionCommand): FactoryInput {
  const common = {
    id,
    amount: parseMoney(command.amount, command.currency ?? DEFAULT_CURRENCY),
    date,
    description: command.description,
    category: command.category,
  };
  if (command.type === 'TRANSFER') {
    assertDomain(!!command.fromAccountId && !!command.toAccountId, 'La transferencia requiere cuenta origen y destino');
    return { ...common, type: 'TRANSFER', fromAccountId: command.fromAccountId, toAccountId: command.toAccountId };
  }
  if (command.type === 'INCOME' || command.type === 'EXPENSE') {
    assertDomain(!!command.accountId, 'El ingreso o gasto requiere una cuenta');
    return { ...common, type: command.type, accountId: command.accountId };
  }
  throw new DomainValidationError(`Tipo de transacción inválido: ${String(command.type)}`);
}

export async function assertAccountsExist(accounts: AccountRepository, input: FactoryInput): Promise<void> {
  const ids = input.type === 'TRANSFER' ? [input.fromAccountId, input.toAccountId] : [input.accountId];
  const found = await Promise.all(ids.map((id) => accounts.findById(id)));
  const missing = ids.find((_, i) => !found[i]);
  if (missing) throw new UnknownAccountError(missing);
}
