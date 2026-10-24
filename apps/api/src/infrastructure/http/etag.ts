import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';

function etagOf(body: unknown): string {
  return `"${createHash('sha1').update(JSON.stringify(body)).digest('base64url')}"`;
}

function matches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header.split(',').some((candidate) => {
    const value = candidate.trim().replace(/^W\//, '');
    return value === '*' || value === etag;
  });
}

/**
 * Datos financieros privados: `Cache-Control: private, no-cache` + ETag para revalidación.
 * Devuelve `undefined` (y responde 304) cuando el cliente ya tiene la versión vigente.
 */
export function withEtag<T>(req: Request, res: Response, body: T): T | undefined {
  const etag = etagOf(body);
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'private, no-cache');
  if (matches(req.headers['if-none-match'], etag)) {
    res.status(304);
    return undefined;
  }
  return body;
}
