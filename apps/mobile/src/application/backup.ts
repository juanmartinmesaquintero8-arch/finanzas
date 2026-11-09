import {
  ACCOUNT_TYPES,
  Account,
  CardPurchase,
  CreditCard,
  DomainValidationError,
  FREQUENCIES,
  InterestRate,
  InvalidMoneyError,
  MAX_MV_PPM,
  Money,
  ScheduledExpense,
  ScheduledIncome,
  TRANSACTION_TYPES,
  TransactionFactory,
  type AccountType,
  type CardFee,
  type Frequency,
  type Transaction,
  type TransactionType,
} from '@finanzas/domain';
import type { LedgerSnapshot, LedgerWrite } from '@/data/idb-ledger-store';
import { MAX_CARD_ID, MAX_CARD_PURCHASES, MAX_CREDIT_CARDS, MAX_IMPORT_TEXT, isInt64 } from './limits';
import { isoDay, parseDay } from './support';
import { toAccountView, toScheduledView, toTransactionView } from './views';

/** Versión del formato del archivo. Subirla cuando cambie la forma de los datos. */
export const BACKUP_VERSION = 3;

/** Tamaño máximo del archivo de copia (bytes). */
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
/** Cantidad máxima de elementos por lista. */
export const MAX_ITEMS = { accounts: 500, transactions: 200_000, scheduledExpenses: 2_000, scheduledIncomes: 2_000, creditCards: MAX_CREDIT_CARDS, cardPurchases: MAX_CARD_PURCHASES } as const;
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
  creditCards: ReturnType<typeof toCardRow>[];
  cardPurchases: ReturnType<typeof toPurchaseRow>[];
}

export interface BackupSummary {
  accounts: number;
  transactions: number;
  scheduledExpenses: number;
  scheduledIncomes: number;
  creditCards: number;
  cardPurchases: number;
  exportedAt: string;
}

export type ParsedBackup =
  | { ok: true; snapshot: LedgerSnapshot; summary: BackupSummary }
  | { ok: false; error: string };

export function backupFileName(now: Date): string {
  return `mis-finanzas-${now.toISOString().slice(0, 10)}.json`;
}

function toCardRow(c: CreditCard) {
  return {
    id: c.id,
    name: c.name,
    dueDay: c.dueDay,
    paymentAccountId: c.paymentAccountId,
    fee: c.fee.kind === 'NONE' ? { kind: c.fee.kind } : { kind: c.fee.kind, amount: c.fee.amount.toJSON() },
    rate: c.rate ? { basis: c.rate.basis, ppm: c.rate.ppm } : null,
    feeStartMonth: c.feeStartMonth,
    feesSettledThrough: c.feesSettledThrough ?? null,
  };
}

function toPurchaseRow(p: CardPurchase) {
  return {
    id: p.id,
    cardId: p.cardId,
    description: p.description,
    category: p.category ?? null,
    amount: p.amount.toJSON(),
    installments: p.installments,
    purchaseDate: isoDay(p.purchaseDate),
    firstDueDate: isoDay(p.firstDueDate),
    monthlyRatePpm: p.monthlyRatePpm,
    paidInstallments: p.paidInstallments,
    closedOn: p.closedOn ? isoDay(p.closedOn) : null,
    dueDayAnchor: p.dueDayAnchor ?? null,
  };
}

export function serializeBackup(snapshot: LedgerWrite, exportedAt: Date): string {
  const file: BackupFile = {
    version: BACKUP_VERSION,
    exportedAt: exportedAt.toISOString(),
    accounts: snapshot.accounts.map(toAccountView),
    transactions: snapshot.transactions.map(toTransactionView),
    scheduledExpenses: snapshot.scheduledExpenses.map(toScheduledView),
    scheduledIncomes: snapshot.scheduledIncomes.map(toScheduledView),
    creditCards: (snapshot.creditCards ?? []).map(toCardRow),
    cardPurchases: (snapshot.cardPurchases ?? []).map(toPurchaseRow),
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
type Kind = 'account' | 'transaction' | 'scheduled' | 'income' | 'card' | 'purchase';
/** Cómo nombrar el dato en los mensajes: «la cuenta «X»» o, si no hay texto que lo identifique, «una cuenta». */
function labelOf(kind: Kind, identifier: unknown): string {
  const nouns = {
    account: ['la cuenta', 'una cuenta'],
    transaction: ['el movimiento', 'un movimiento'],
    scheduled: ['el gasto programado', 'un gasto programado'],
    income: ['el ingreso programado', 'un ingreso programado'],
    card: ['la tarjeta', 'una tarjeta'],
    purchase: ['la compra', 'una compra'],
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

const unusable = (who: string, problem: string) => new Invalid(`${UNUSABLE_PREFIX}${who} ${problem}`);
const invalidData = (who: string) => unusable(who, 'tiene datos que no son válidos.');
const invalidRate = (who: string) => unusable(who, 'tiene una tasa de interés que no es válida.');

/** Los errores del dominio de una tarjeta o compra se dicen nombrando el dato. */
function checked<T>(who: string, build: () => T): T {
  try {
    return build();
  } catch (e) {
    if (e instanceof Invalid) throw e;
    throw invalidData(who);
  }
}

function cardScopedId(v: unknown, who: string): string {
  const value = id(v);
  // `cp-<compra>-liq` y `cf-<tarjeta>-AAAA-MM` deben caber en un id válido de movimiento.
  if (value.length > MAX_CARD_ID) throw unusable(who, 'tiene un identificador demasiado largo.');
  return value;
}

function cardDate(v: unknown, who: string): Date {
  try {
    const d = parseDay(str(v));
    if (d.getUTCFullYear() < 2000 || d.getUTCFullYear() > 2100) throw new Invalid('');
    return d;
  } catch {
    throw unusable(who, 'tiene una fecha que no es válida.');
  }
}

function parseCardFee(raw: unknown, who: string): CardFee {
  if (!isObj(raw)) throw invalidData(who);
  const kind = checked(who, () => oneOf(['NONE', 'FIXED_MONTHLY', 'ON_MOVEMENT'] as const, raw.kind));
  return kind === 'NONE' ? { kind } : { kind, amount: money(raw.amount, who) };
}

function parseCardRate(raw: unknown, who: string): InterestRate | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (!isObj(raw)) throw invalidRate(who);
  try {
    return InterestRate.create({ basis: raw.basis as 'MV' | 'EA', ppm: raw.ppm as number });
  } catch {
    throw invalidRate(who);
  }
}

function parseCard(raw: unknown): CreditCard {
  if (!isObj(raw)) throw new Invalid(DAMAGED);
  const who = labelOf('card', raw.name);
  const cardId = cardScopedId(raw.id, who);
  // Monto y tasa antes que el texto: así el mensaje puede nombrar el dato aunque su texto esté dañado.
  const fee = parseCardFee(raw.fee, who);
  const rate = parseCardRate(raw.rate, who);
  const name = text(raw.name, who);
  return checked(who, () =>
    CreditCard.create({
      id: cardId,
      name,
      dueDay: raw.dueDay as number,
      paymentAccountId: id(raw.paymentAccountId),
      fee,
      rate,
      feeStartMonth: str(raw.feeStartMonth),
      feesSettledThrough: optStr(raw.feesSettledThrough),
    }),
  );
}

function parsePurchase(raw: unknown): CardPurchase {
  if (!isObj(raw)) throw new Invalid(DAMAGED);
  const who = labelOf('purchase', raw.description);
  const purchaseId = cardScopedId(raw.id, who);
  const amount = money(raw.amount, who);
  const ppm = raw.monthlyRatePpm;
  if (typeof ppm !== 'number' || !Number.isSafeInteger(ppm) || ppm < 0 || ppm > MAX_MV_PPM) throw invalidRate(who);
  const description = text(raw.description, who);
  const category = optText(raw.category, who);
  const installments = raw.installments as number;
  const paidInstallments = raw.paidInstallments as number;
  if (Number.isInteger(installments) && Number.isInteger(paidInstallments) && paidInstallments > installments) {
    throw unusable(who, 'tiene más cuotas pagadas que cuotas.');
  }
  const purchaseDate = cardDate(raw.purchaseDate, who);
  const firstDueDate = cardDate(raw.firstDueDate, who);
  const closedOn = raw.closedOn === null || raw.closedOn === undefined ? undefined : cardDate(raw.closedOn, who);
  return checked(who, () =>
    CardPurchase.create({
      id: purchaseId,
      cardId: id(raw.cardId),
      description,
      category,
      amount,
      installments,
      purchaseDate,
      firstDueDate,
      monthlyRatePpm: ppm,
      paidInstallments,
      closedOn,
      dueDayAnchor: raw.dueDayAnchor === null || raw.dueDayAnchor === undefined ? undefined : (raw.dueDayAnchor as number),
    }),
  );
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
    // Las copias v1 no traen ingresos programados (valen vacío); desde la v2 la lista es obligatoria.
    if (json.version >= 2 && json.scheduledIncomes === undefined) throw new Invalid(DAMAGED);
    const incomesRaw = json.version >= 2 ? arrayOf(json.scheduledIncomes) : [];
    // Las copias v1 y v2 no traen tarjetas (valen vacío); desde la v3 las dos listas son obligatorias.
    if (json.version >= 3 && (json.creditCards === undefined || json.cardPurchases === undefined)) throw new Invalid(DAMAGED);
    const cardsRaw = json.version >= 3 ? arrayOf(json.creditCards) : [];
    const purchasesRaw = json.version >= 3 ? arrayOf(json.cardPurchases) : [];
    if (
      accountsRaw.length > MAX_ITEMS.accounts ||
      transactionsRaw.length > MAX_ITEMS.transactions ||
      scheduledRaw.length > MAX_ITEMS.scheduledExpenses ||
      incomesRaw.length > MAX_ITEMS.scheduledIncomes ||
      cardsRaw.length > MAX_ITEMS.creditCards ||
      purchasesRaw.length > MAX_ITEMS.cardPurchases
    ) {
      throw new Invalid(TOO_MANY);
    }
    if (typeof json.exportedAt !== 'string') throw new Invalid(NOT_A_BACKUP);

    let accounts: Account[];
    let transactions: Transaction[];
    let scheduledExpenses: ScheduledExpense[];
    let scheduledIncomes: ScheduledIncome[];
    let creditCards: CreditCard[];
    let cardPurchases: CardPurchase[];
    try {
      accounts = accountsRaw.map(parseAccount);
      transactions = transactionsRaw.map(parseTransaction);
      scheduledExpenses = scheduledRaw.map(parseScheduled);
      scheduledIncomes = incomesRaw.map(parseIncome);
      creditCards = cardsRaw.map(parseCard);
      cardPurchases = purchasesRaw.map(parsePurchase);
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
    assertUniqueIds(creditCards);
    assertUniqueIds(cardPurchases);
    const known = new Set(accounts.map((a) => a.id));
    const missingAccount = () => new Invalid('La copia tiene movimientos, gastos o ingresos de una cuenta que no existe en ella.');
    for (const t of transactions) if (t.accountIds().some((id) => !known.has(id))) throw missingAccount();
    for (const s of scheduledExpenses) if (!known.has(s.accountId)) throw missingAccount();
    for (const i of scheduledIncomes) if (!known.has(i.accountId)) throw missingAccount();
    const knownCards = new Set(creditCards.map((c) => c.id));
    for (const c of creditCards) {
      if (!known.has(c.paymentAccountId)) throw unusable(labelOf('card', c.name), 'se paga desde una cuenta que no existe en la copia.');
    }
    for (const p of cardPurchases) {
      if (!knownCards.has(p.cardId)) throw unusable(labelOf('purchase', p.description), 'es de una tarjeta que no existe en la copia.');
    }

    return {
      ok: true,
      snapshot: { accounts, transactions, scheduledExpenses, scheduledIncomes, creditCards, cardPurchases },
      summary: {
        accounts: accounts.length,
        transactions: transactions.length,
        scheduledExpenses: scheduledExpenses.length,
        scheduledIncomes: scheduledIncomes.length,
        creditCards: creditCards.length,
        cardPurchases: cardPurchases.length,
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
