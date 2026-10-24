import type { TransactionCursor } from '@finanzas/domain';
import { AppError } from './support';

/** Cursor opaco de paginación: base64({ d: fecha ISO, i: id }). */
export function encodeCursor(cursor: TransactionCursor): string {
  return btoa(JSON.stringify({ d: cursor.date.toISOString(), i: cursor.id }));
}

export function decodeCursor(raw: string): TransactionCursor {
  try {
    const { d, i } = JSON.parse(atob(raw)) as { d: string; i: string };
    const date = new Date(d);
    if (typeof i !== 'string' || Number.isNaN(date.getTime())) throw new Error('shape');
    return { date, id: i };
  } catch {
    throw new AppError('El cursor de paginación es inválido');
  }
}
