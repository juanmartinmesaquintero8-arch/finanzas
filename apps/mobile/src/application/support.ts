import {
  DomainValidationError,
  InvalidMoneyError,
  Money,
  UnknownAccountError,
  startOfDayUTC,
  type AccountRepository,
  type ScheduledExpenseRepository,
  type TransactionRepository,
} from '@finanzas/domain';
import type { ActionResult } from '@finanzas/ui';
import type { IdbLedgerStore } from '@/data/idb-ledger-store';
import type { ChangeBus } from './change-bus';

export const CURRENCY = 'COP';

/** Todo lo que necesitan los servicios; se inyecta para poder probarlos con relojes e ids falsos. */
export interface ServiceContext {
  accounts: AccountRepository & { delete(id: string): Promise<void> };
  transactions: TransactionRepository;
  scheduled: ScheduledExpenseRepository;
  ledger: IdbLedgerStore;
  bus: ChangeBus;
  now: () => Date;
  newId: () => string;
}

/** Error esperable (el usuario puede corregirlo): su mensaje se muestra tal cual. */
export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what: string) => new AppError(`No encontramos ${what}.`);

const INTEGER = /^-?\d+$/;

export function parseMoney(raw: string): Money {
  const text = String(raw).trim();
  if (!INTEGER.test(text)) throw new InvalidMoneyError(`El monto debe ser un número entero: ${text}`);
  return Money.of(BigInt(text), CURRENCY);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' (o ISO completo) normalizado al día UTC. */
export function parseDay(raw: string): Date {
  const date = new Date(DAY.test(raw) ? `${raw}T00:00:00Z` : raw);
  if (Number.isNaN(date.getTime())) throw new DomainValidationError(`Fecha inválida: ${raw}`);
  return startOfDayUTC(date);
}

export const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

const GENERIC_ERROR = 'Ocurrió un error inesperado. Intenta de nuevo.';

/** Convierte cualquier fallo en un mensaje simple en español; nunca lanza al componente. */
export function toMessage(e: unknown): string {
  if (e instanceof AppError || e instanceof DomainValidationError || e instanceof InvalidMoneyError || e instanceof UnknownAccountError) {
    return e.message;
  }
  return GENERIC_ERROR;
}

/** Ejecuta una escritura y avisa del cambio sólo si salió bien. */
export async function writeAction(ctx: Pick<ServiceContext, 'bus'>, action: () => Promise<void>): Promise<ActionResult> {
  try {
    await action();
  } catch (e) {
    return { ok: false, error: toMessage(e) };
  }
  ctx.bus.emit();
  return { ok: true };
}
