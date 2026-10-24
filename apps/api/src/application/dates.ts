import { DomainValidationError, startOfDayUTC } from '@finanzas/domain';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Parsea 'YYYY-MM-DD' (o un ISO completo, normalizado al día UTC). */
export function parseDay(raw: string): Date {
  const date = new Date(DAY.test(raw) ? `${raw}T00:00:00Z` : raw);
  if (Number.isNaN(date.getTime())) throw new DomainValidationError(`Fecha inválida: ${raw}`);
  return startOfDayUTC(date);
}
