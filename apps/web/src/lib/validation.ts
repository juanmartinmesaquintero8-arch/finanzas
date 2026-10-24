import { parseAmountInput } from './format';
import type { CreateScheduledExpenseInput, CreateTransactionInput, Frequency, TransactionType } from './types';

export type FieldErrors = Record<string, string>;
export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

export interface TransactionFormValues {
  type: TransactionType;
  amountText: string;
  date: string;
  description: string;
  category: string;
  accountId: string;
  fromAccountId: string;
  toAccountId: string;
}

export function validateTransactionForm(v: TransactionFormValues): ValidationResult<CreateTransactionInput> {
  const errors: FieldErrors = {};
  const amount = parseAmountInput(v.amountText);
  if (!amount) errors.amount = 'Escribe un monto mayor a cero.';
  if (!v.description.trim()) errors.description = 'Escribe una descripción.';
  if (!v.date) errors.date = 'Elige una fecha.';

  if (v.type === 'TRANSFER') {
    if (!v.fromAccountId || !v.toAccountId) errors.account = 'Elige la cuenta de origen y la de destino.';
    else if (v.fromAccountId === v.toAccountId) errors.account = 'La cuenta de origen y la de destino deben ser distintas.';
  } else if (!v.accountId) {
    errors.account = 'Elige una cuenta.';
  }

  if (Object.keys(errors).length > 0 || !amount) return { ok: false, errors };

  const value: CreateTransactionInput = {
    type: v.type,
    amount,
    date: v.date,
    description: v.description.trim(),
  };
  const category = v.category.trim();
  if (category && v.type !== 'TRANSFER') value.category = category;
  if (v.type === 'TRANSFER') {
    value.fromAccountId = v.fromAccountId;
    value.toAccountId = v.toAccountId;
  } else {
    value.accountId = v.accountId;
  }
  return { ok: true, value };
}

export interface ScheduledFormValues {
  description: string;
  amountText: string;
  accountId: string;
  frequency: Frequency;
  startDate: string;
}

export function validateScheduledForm(v: ScheduledFormValues): ValidationResult<CreateScheduledExpenseInput> {
  const errors: FieldErrors = {};
  const amount = parseAmountInput(v.amountText);
  if (!v.description.trim()) errors.description = 'Escribe qué vas a pagar.';
  if (!amount) errors.amount = 'Escribe un monto mayor a cero.';
  if (!v.accountId) errors.account = 'Elige de qué cuenta se paga.';
  if (!v.startDate) errors.startDate = 'Elige la fecha del primer pago.';
  if (Object.keys(errors).length > 0 || !amount) return { ok: false, errors };
  return {
    ok: true,
    value: {
      description: v.description.trim(),
      amount,
      accountId: v.accountId,
      frequency: v.frequency,
      startDate: v.startDate,
    },
  };
}
