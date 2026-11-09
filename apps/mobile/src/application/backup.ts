import {
  ACCOUNT_TYPES,
  Account,
  DomainValidationError,
  FREQUENCIES,
  InvalidMoneyError,
  Money,
  ScheduledExpense,
  ScheduledIncome,
  TRANSACTION_TYPES,
  TransactionFactory,
  type AccountType,
  type Frequency,
  type Transaction,
  type TransactionType,
} from '@finanzas/domain';
import type { LedgerSnapshot } from '@/data/idb-ledger-store';
import { MAX_IMPORT_TEXT, isInt64 } from './limits';
import { toAccountView, toScheduledView, toTransactionView } from './views';

/** Versión del formato del archivo. Subirla cuando cambie la forma de los datos. */
export const BACKUP_VERSION = 2;

/** Tamaño máximo del archivo de copia (bytes). */
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
/** Cantidad máxima de elementos por lista. */
export const MAX_ITEMS = { accounts: 500, transactions: 200_000, scheduledExpenses: 2_000, scheduledIncomes: 2_000 } as const;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
export const UNUSABLE_PREFIX = 'La copia no se puede usar: ';
const LABEL_MAX = 40;
const REMINDER_DAYS = 7;
const DAY_MS = 86_400_000;

export interface BackupFile {
  version: number;
  exportedAt: string;
  accounts: ReturnType<typeof toAccountView>[];
  transactions: ReturnType<typeof toTransactionView>[];
  scheduledExpenses: ReturnType<typeof toScheduledView>[];
  scheduledIncomes: ReturnType<typeof toScheduledView>[];
}

export interface BackupSummary {
  accounts: number;
  transactions: number;
  scheduledExpenses: number;
  scheduledIncomes: number;
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
    scheduledIncomes: snapshot.scheduledIncomes.map(toScheduledView),
  };
  return JSON.stringify(file);
}

const NOT_A_BACKUP = 'Este archivo no parece una copia de seguridad de Mis Finanzas.';
const TOO_BIG = 'El archivo pesa más de 50 MB, el máximo que la app puede recuperar.';
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
type Kind = 'account' | 'transaction' | 'scheduled' | 'income';
/** Cómo nombrar el dato en los mensajes: «la cuenta «X»» o, si no hay texto que lo identifique, «una cuenta». */
function labelOf(kind: Kind, identifier: unknown): string {
  const nouns = {
    account: ['la cuenta', 'una cuenta'],
    transaction: ['el movimiento', 'un movimiento'],
    scheduled: ['el gasto programado', 'un gasto programado'],
    income: ['el ingreso programado', 'un ingreso programado'],
  } as const;
  const [named, generic] = nouns[kind];
  if (typeof identifier !== 'string' || identifier.trim().length === 0) return generic;
  const shown = identifier.length > LABEL_MAX ? `${identifier.slice(0, LABEL_MAX)}…` : identifier;
  return `${named} «${shown}»`;
}
const text = (v: unknown, who: string): string => {
  const s = str(v);
  if (s.length > MAX_IMPORT_TEXT) {
    throw new Invalid(`${UNUSABLE_PREFIX}${who} tiene un texto demasiado largo (máximo 2.000 caracteres).`);
  }
  return s;
};
const id = (v: unknown): string => {
  const s = str(v);
  if (!ID_PATTERN.test(s)) throw new Invalid(DAMAGED);
  return s;
};
const optStr = (v: unknown): string | undefined => (v === null || v === undefined ? undefined : str(v));
const optText = (v: unknown, who: string): string | undefined => (v === null || v === undefined ? undefined : text(v, who));
const money = (v: unknown, who: string): Money => {
  if (!isObj(v)) throw new Invalid(DAMAGED);
  const amount = str(v.amount);
  const currency = str(v.currency);
  if (!/^-?\d+$/.test(amount)) throw new Invalid(DAMAGED);
  const value = BigInt(amount);
  if (!isInt64(value)) throw new Invalid(`${UNUSABLE_PREFIX}${who} tiene un monto demasiado grande.`);
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
  const who = labelOf('account', raw.name);
  // El monto se revisa antes que el texto: así el mensaje puede nombrar el dato aunque su texto esté dañado.
  const initialBalance = money(raw.initialBalance, who);
  return Account.create({
    id: id(raw.id),
    name: text(raw.name, who),
    type: oneOf<AccountType>(ACCOUNT_TYPES, raw.type),
    initialBalance,
  });
}

function parseTransaction(raw: unknown): Transaction {
  if (!isObj(raw)) throw new Invalid(DAMAGED);
  const who = labelOf('transaction', raw.description);
  const common = {
    id: id(raw.id),
    amount: money(raw.amount, who),
    date: date(raw.date),
    description: text(raw.description, who),
    category: optText(raw.category, who),
  };
  const type = oneOf<TransactionType>(TRANSACTION_TYPES, raw.type);
  if (type === 'TRANSFER') {
    return TransactionFactory.create({ ...common, type, fromAccountId: id(raw.fromAccountId), toAccountId: id(raw.toAccountId) });
  }
  return TransactionFactory.create({ ...common, type, accountId: id(raw.accountId) });
}

/** Campos que comparten los gastos y los ingresos programados en el archivo. */
function parseSchedule(raw: unknown, kind: 'scheduled' | 'income') {
  if (!isObj(raw)) throw new Invalid(DAMAGED);
  const endDate = optStr(raw.endDate);
  const settledThrough = optStr(raw.settledThrough);
  const who = labelOf(kind, raw.description);
  const amount = money(raw.amount, who);
  return {
    id: id(raw.id),
    description: text(raw.description, who),
    amount,
    accountId: id(raw.accountId),
    frequency: oneOf<Frequency>(FREQUENCIES, raw.frequency),
    startDate: date(raw.startDate),
    endDate: endDate ? date(endDate) : undefined,
    settledThrough: settledThrough ? date(settledThrough) : undefined,
    category: optText(raw.category, who),
  };
}

const parseScheduled = (raw: unknown): ScheduledExpense => ScheduledExpense.create(parseSchedule(raw, 'scheduled'));
const parseIncome = (raw: unknown): ScheduledIncome => ScheduledIncome.create(parseSchedule(raw, 'income'));

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
    // Las copias v1 no traen ingresos programados (valen vacío); desde la v2 la lista es obligatoria.
    if (json.version >= 2 && json.scheduledIncomes === undefined) throw new Invalid(DAMAGED);
    const incomesRaw = json.version >= 2 ? arrayOf(json.scheduledIncomes) : [];
    if (
      accountsRaw.length > MAX_ITEMS.accounts ||
      transactionsRaw.length > MAX_ITEMS.transactions ||
      scheduledRaw.length > MAX_ITEMS.scheduledExpenses ||
      incomesRaw.length > MAX_ITEMS.scheduledIncomes
    ) {
      throw new Invalid(TOO_MANY);
    }
    if (typeof json.exportedAt !== 'string') throw new Invalid(NOT_A_BACKUP);

    let accounts: Account[];
    let transactions: Transaction[];
    let scheduledExpenses: ScheduledExpense[];
    let scheduledIncomes: ScheduledIncome[];
    try {
      accounts = accountsRaw.map(parseAccount);
      transactions = transactionsRaw.map(parseTransaction);
      scheduledExpenses = scheduledRaw.map(parseScheduled);
      scheduledIncomes = incomesRaw.map(parseIncome);
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
    assertUniqueIds(scheduledIncomes);
    const known = new Set(accounts.map((a) => a.id));
    const missingAccount = () => new Invalid('La copia tiene movimientos, gastos o ingresos de una cuenta que no existe en ella.');
    for (const t of transactions) if (t.accountIds().some((id) => !known.has(id))) throw missingAccount();
    for (const s of scheduledExpenses) if (!known.has(s.accountId)) throw missingAccount();
    for (const i of scheduledIncomes) if (!known.has(i.accountId)) throw missingAccount();

    return {
      ok: true,
      snapshot: { accounts, transactions, scheduledExpenses, scheduledIncomes },
      summary: {
        accounts: accounts.length,
        transactions: transactions.length,
        scheduledExpenses: scheduledExpenses.length,
        scheduledIncomes: scheduledIncomes.length,
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
