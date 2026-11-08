import { describe, expect, it } from 'vitest';
import { CONTENT_SECURITY_POLICY } from './csp';

/** Separa la política en directivas: { 'default-src': ["'self'"], ... }. */
function directives(policy: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) map.set(name, sources);
  }
  return map;
}

describe('CONTENT_SECURITY_POLICY', () => {
  it.each([
    "default-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "connect-src 'self'",
    "img-src 'self' data:",
    "worker-src 'self'",
    "manifest-src 'self'",
  ])('incluye %s', (directive) => {
    expect(CONTENT_SECURITY_POLICY).toContain(directive);
  });

  it("nunca permite 'unsafe-eval'", () => {
    expect(CONTENT_SECURITY_POLICY).not.toContain("'unsafe-eval'");
  });

  it('no usa * como origen en ninguna directiva', () => {
    for (const sources of directives(CONTENT_SECURITY_POLICY).values()) {
      expect(sources.some((s) => s.includes('*'))).toBe(false);
    }
  });

  it('no repite directivas (el navegador ignoraría la segunda)', () => {
    const names = CONTENT_SECURITY_POLICY.split(';')
      .map((p) => p.trim().split(/\s+/)[0])
      .filter(Boolean);
    expect(new Set(names).size).toBe(names.length);
  });
});
