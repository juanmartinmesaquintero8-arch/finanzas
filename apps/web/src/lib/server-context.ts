import { ApiError, NetworkError } from './api-client';
import { todayISO } from './format';

/**
 * "Hoy" para consultar la API: la API calcula con el día UTC, que puede ir un día
 * adelante de Colombia por la noche; se toma el mayor para no pedir un corte anterior a hoy.
 */
export function todayForApi(now: Date = new Date()): string {
  const utc = now.toISOString().slice(0, 10);
  const co = todayISO(now);
  return utc > co ? utc : co;
}

export function describeError(e: unknown): string {
  if (e instanceof ApiError || e instanceof NetworkError) return e.message;
  return 'Ocurrió un error inesperado. Intenta de nuevo.';
}
