import {
  ACCOUNT_TYPES,
  Account,
  DomainValidationError,
  FREQUENCIES,
  InvalidMoneyError,
  Money,
  ScheduledExpense,
  TRANSACTION_TYPES,
  TransactionFactory,
  type AccountType,
  type Frequency,
  type Transaction,
  type TransactionType,
} from '@finanzas/domain';
import type { LedgerSnapshot } from '@/data/idb-ledger-store';
import { toAccountView, toScheduledView, toTransactionView } from './views';

/** Versión del formato del archivo. Subirla cuando cambie la forma de los datos. */
export const BACKUP_VERSION = 1;

/** Tamaño máximo del archivo de copia (bytes). */
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
/** Cantidad máxima de elementos por lista. */
export const MAX_ITEMS = { accounts: 500, transactions: 200_000, scheduledExpenses: 2_000 } as const;
/** Largos máximos de texto: los mismos de los formularios y de la API. */
export const MAX_TEXT = { id: 100, name: 80, description: 160, category: 60 } as const;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;
const REMINDER_DAYS = 7;
const DAY_MS = 86_400_000;

export interface BackupFile {
  version: number;
  exportedAt: string;
  accounts: ReturnType<typeof toAccountView>[];
  transactions: ReturnType<typeof toTransactionView>[];
  scheduledExpenses: ReturnType<typeof toScheduledView>[];
}

export interface BackupSummary {
  accounts: number;
  transactions: number;
  scheduledExpenses: number;
  exportedAt: string;
}

export type ParsedBackup =
  | { ok: true; snapshot: LedgerSnapshot; summary: BackupSummary }
  | { ok: false; error: string };

export function backupFileName(now: Date): string {
  return `mis-finanzas-${now.toISOString().slice(0, 10)}.json`;
}

export function serializeBackup(snapshot: LedgerSnapshot, exportedAt: Date): string {
  const file: BackupFile = {
    version: BACKUP_VERSION,
    exportedAt: exportedAt.toISOString(),
    accounts: snapshot.accounts.map(toAccountView),
    transactions: snapshot.transactions.map(toTransactionView),
    scheduledExpenses: snapshot.scheduledExpenses.map(toScheduledView),
  };
  return JSON.stringify(file);
}

const NOT_A_BACKUP = 'Este archivo no parece una copia de seguridad de Mis Finanzas.';
const TOO_BIG = 'El archivo es demasiado grande para ser una copia de Mis Finanzas (máximo 10 MB).';
const TOO_MANY = 'La copia tiene más datos de los que la app puede manejar, así que no se puede usar.';
const DAMAGED = 'La copia de seguridad está dañada o incompleta, así que no se puede usar.';
const NEWER = 'Esta copia fue hecha con una versión más nueva de la app. Actualiza la app e inténtalo de nuevo.';

/** Revisa el tamaño del archivo ANTES de leerlo. Devuelve el mensaje de error o null si está bien. */
export function checkBackupFileSize(size: number): string | null {
  return size > MAX_BACKUP_BYTES ? TOO_BIG : null;
}

class Invalid extends Error {}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => {
  if (typeof v !== 'string') throw new Invalid(DAMAGED);
  return v;
};
const text = (v: unknown, max: number): string => {
  const s = str(v);
  if (s.length > max) throw new Invalid(DAMAGED);
  return s;
};
const id = (v: unknown): string => {
  const s = str(v);
  if (!ID_PATTERN.test(s)) throw new Invalid(DAMAGED);
  return s;
};
const optStr = (v: unknown): string | undefined => (v === null || v === undefined ? undefined : str(v));
const optText = (v: unknown, max: number): string | undefined => (v === null || v === undefined ? undefined : text(v, max));
const money = (v: unknown): Money => {
  if (!isObj(v)) throw new Invalid(DAMAGED);
  const amount = str(v.amount);
  const currency = str(v.currency);
  if (!/^-?\d+$/.test(amount)) throw new Invalid(DAMAGED);
  const value = BigInt(amount);
  if (value < INT64_MIN || value > INT64_MAX) throw new Invalid(DAMAGED);
  return Money.of(value, currency);
};
const date = (v: unknown): Date => {
  const d = new Date(str(v));
  if (Number.isNaN(d.getTime())) throw new Invalid(DAMAGED);
  return d;
};
const oneOf = <T extends string>(allowed: readonly T[], v: unknown): T => {
  if (!allowed.includes(v as T)) throw new Invalid(DAMAGED);
  return v as T;
};
const arrayOf = (v: unknown): unknown[] => {
  if (!Array.isArray(v)) throw new Invalid(NOT_A_BACKUP);
  return v;
};

function parseAccount(raw: unknown): Account {
  if (!isObj(raw)) throw new Invalid(DAMAGED);
  return Account.create({
    id: id(raw.id),
    name: text(raw.name, MAX_TEXT.name),
    type: oneOf<AccountType>(ACCOUNT_TYPES, raw.type),
    initialBalance: money(raw.initialBalance),
  });
}

function parseTransaction(raw: unknown): Transaction {
  if (!isObj(raw)) throw new Invalid(DAMAGED);
  const common = {
    id: id(raw.id),
    amount: money(raw.amount),
    date: date(raw.date),
    description: text(raw.description, MAX_TEXT.description),
    category: optText(raw.category, MAX_TEXT.category),
  };
  const type = oneOf<TransactionType>(TRANSACTION_TYPES, raw.type);
  if (type === 'TRANSFER') {
    return TransactionFactory.create({ ...common, type, fromAccountId: id(raw.fromAccountId), toAccountId: id(raw.toAccountId) });
  }
  return TransactionFactory.create({ ...common, type, accountId: id(raw.accountId) });
}

function parseScheduled(raw: unknown): ScheduledExpense {
  if (!isObj(raw)) throw new Invalid(DAMAGED);
  const endDate = optStr(raw.endDate);
  const settledThrough = optStr(raw.settledThrough);
  return ScheduledExpense.create({
    id: id(raw.id),
    description: text(raw.description, MAX_TEXT.description),
    amount: money(raw.amount),
    accountId: id(raw.accountId),
    frequency: oneOf<Frequency>(FREQUENCIES, raw.frequency),
    startDate: date(raw.startDate),
    endDate: endDate ? date(endDate) : undefined,
    settledThrough: settledThrough ? date(settledThrough) : undefined,
  });
}

function assertUniqueIds(items: readonly { id: string }[]): void {
  if (new Set(items.map((i) => i.id)).size !== items.length) {
    throw new Invalid('La copia tiene datos repetidos, así que no se puede usar.');
  }
}

/**
 * Valida una copia de seguridad SIN tocar nada: sólo si todo es coherente devuelve los datos
 * (ya como entidades del dominio) y un resumen para que la persona confirme.
 */
export function parseBackup(text: string): ParsedBackup {
  try {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Invalid(NOT_A_BACKUP);
    }
    if (!isObj(json) || typeof json.version !== 'number' || !Number.isInteger(json.version) || json.version < 1) {
      throw new Invalid(NOT_A_BACKUP);
    }
    if (json.version > BACKUP_VERSION) throw new Invalid(NEWER);
    const accountsRaw = arrayOf(json.accounts);
    const transactionsRaw = arrayOf(json.transactions);
    const scheduledRaw = arrayOf(json.scheduledExpenses);
    if (
      accountsRaw.length > MAX_ITEMS.accounts ||
      transactionsRaw.length > MAX_ITEMS.transactions ||
      scheduledRaw.length > MAX_ITEMS.scheduledExpenses
    ) {
      throw new Invalid(TOO_MANY);
    }
    if (typeof json.exportedAt !== 'string') throw new Invalid(NOT_A_BACKUP);

    let accounts: Account[];
    let transactions: Transaction[];
    let scheduledExpenses: ScheduledExpense[];
    try {
      accounts = accountsRaw.map(parseAccount);
      transactions = transactionsRaw.map(parseTransaction);
      scheduledExpenses = scheduledRaw.map(parseScheduled);
    } catch (e) {
      if (e instanceof Invalid) throw e;
      if (e instanceof DomainValidationError || e instanceof InvalidMoneyError || e instanceof RangeError || e instanceof SyntaxError) {
        throw new Invalid(DAMAGED);
      }
      throw e;
    }

    assertUniqueIds(accounts);
    assertUniqueIds(transactions);
    assertUniqueIds(scheduledExpenses);
    const known = new Set(accounts.map((a) => a.id));
    const missingAccount = () => new Invalid('La copia tiene movimientos o gastos de una cuenta que no existe en ella.');
    for (const t of transactions) if (t.accountIds().some((id) => !known.has(id))) throw missingAccount();
    for (const s of scheduledExpenses) if (!known.has(s.accountId)) throw missingAccount();

    return {
      ok: true,
      snapshot: { accounts, transactions, scheduledExpenses },
      summary: {
        accounts: accounts.length,
        transactions: transactions.length,
        scheduledExpenses: scheduledExpenses.length,
        exportedAt: json.exportedAt,
      },
    };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message };
    return { ok: false, error: NOT_A_BACKUP };
  }
}

/** Recordatorio suave: hay datos y nunca se hizo copia, o la última tiene más de 7 días. */
export function isBackupReminderDue({ lastBackupAt, hasData, now }: { lastBackupAt: string | null; hasData: boolean; now: Date }): boolean {
  if (!hasData) return false;
  const last = lastBackupAt ? new Date(lastBackupAt).getTime() : Number.NaN;
  if (Number.isNaN(last)) return true;
  return now.getTime() - last > REMINDER_DAYS * DAY_MS;
}
