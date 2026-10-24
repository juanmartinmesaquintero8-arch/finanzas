'use server';

import { revalidateTag } from 'next/cache';
import { getApiClient } from '@/lib/api-client';
import type { ActionResult } from '@/lib/action-result';
import { createMutations } from '@/lib/mutations';
import type {
  CreateAccountInput,
  CreateScheduledExpenseInput,
  CreateTransactionInput,
  TransactionPage,
} from '@/lib/types';

const mutations = () => createMutations(getApiClient(), revalidateTag);

export async function createTransactionAction(input: CreateTransactionInput): Promise<ActionResult> {
  return mutations().createTransaction(input);
}

export async function deleteTransactionAction(id: string): Promise<ActionResult> {
  return mutations().deleteTransaction(id);
}

export async function createAccountAction(input: CreateAccountInput): Promise<ActionResult> {
  return mutations().createAccount(input);
}

export async function createScheduledExpenseAction(input: CreateScheduledExpenseInput): Promise<ActionResult> {
  return mutations().createScheduledExpense(input);
}

export async function deleteScheduledExpenseAction(id: string): Promise<ActionResult> {
  return mutations().deleteScheduledExpense(id);
}

export async function settleScheduledExpenseAction(id: string, through: string): Promise<ActionResult> {
  return mutations().settleScheduledExpense(id, through);
}

export async function loadTransactionsAction(params: { accountId?: string; cursor: string }): Promise<TransactionPage> {
  return mutations().loadTransactions(params);
}
