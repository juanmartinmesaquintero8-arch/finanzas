import { TransactionCursor } from '@finanzas/domain';
import { InvalidRequestError } from '../errors';

/** Cursor opaco para la paginación keyset: base64url({ d: fecha ISO, i: id }). */
export function encodeCursor(cursor: TransactionCursor): string {
  return Buffer.from(JSON.stringify({ d: cursor.date.toISOString(), i: cursor.id })).toString('base64url');
}

export function decodeCursor(raw: string): TransactionCursor {
  try {
    const { d, i } = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { d: string; i: string };
    const date = new Date(d);
    if (typeof i !== 'string' || Number.isNaN(date.getTime())) throw new Error('shape');
    return { date, id: i };
  } catch {
    throw new InvalidRequestError('El cursor de paginación es inválido');
  }
}
