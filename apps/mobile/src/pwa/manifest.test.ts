import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildManifest } from './manifest';

const publicDir = join(__dirname, '..', '..', 'public');

describe('buildManifest', () => {
  it('describe la app instalable en español', () => {
    const m = buildManifest('');
    expect(m).toMatchObject({
      name: 'Mis Finanzas',
      short_name: 'Finanzas',
      display: 'standalone',
      lang: 'es',
      start_url: '/',
      scope: '/',
    });
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('start_url, scope e íconos respetan el basePath de GitHub Pages', () => {
    const m = buildManifest('/finanzas');
    expect(m.start_url).toBe('/finanzas/');
    expect(m.scope).toBe('/finanzas/');
    expect(m.id).toBe('/finanzas/');
    expect(m.icons.every((i) => i.src.startsWith('/finanzas/icons/'))).toBe(true);
  });

  it('incluye íconos 192 y 512, y versiones "maskable"', () => {
    const { icons } = buildManifest('');
    const has = (size: string, purpose: string) => icons.some((i) => i.sizes === size && i.purpose === purpose);
    expect(has('192x192', 'any')).toBe(true);
    expect(has('512x512', 'any')).toBe(true);
    expect(has('512x512', 'maskable')).toBe(true);
    expect(has('192x192', 'maskable')).toBe(true);
  });

  it('todos los íconos existen como PNG reales del tamaño que dicen', () => {
    for (const icon of buildManifest('').icons) {
      const file = join(publicDir, icon.src);
      expect(existsSync(file), icon.src).toBe(true);
      const png = readFileSync(file);
      expect(png.subarray(1, 4).toString('ascii'), icon.src).toBe('PNG');
      const [w, h] = icon.sizes.split('x').map(Number);
      expect([png.readUInt32BE(16), png.readUInt32BE(20)], icon.src).toEqual([w, h]);
    }
  });
});
