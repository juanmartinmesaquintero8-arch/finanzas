import { describe, expect, it } from 'vitest';
import { normalizeCategory } from './category';

describe('normalizeCategory', () => {
  it('recorta, une espacios y pasa a minúsculas para la clave', () => {
    expect(normalizeCategory('  Mercado   Grande ')).toEqual({ key: 'mercado grande', label: 'Mercado Grande' });
  });

  it('quita las tildes de las vocales en la clave pero conserva la grafía en la etiqueta', () => {
    expect(normalizeCategory('Educación')).toEqual({ key: 'educacion', label: 'Educación' });
    expect(normalizeCategory('CAFÉ')).toEqual({ key: 'cafe', label: 'CAFÉ' });
    expect(normalizeCategory('Pingüino').key).toBe('pinguino');
  });

  it('conserva la ñ: "año" no es "ano"', () => {
    expect(normalizeCategory('Año').key).toBe('año');
    expect(normalizeCategory('AÑO').key).toBe('año');
    expect(normalizeCategory('año').key).not.toBe(normalizeCategory('ano').key);
    // La ñ escrita como n + tilde combinada también es ñ.
    expect(normalizeCategory('año').key).toBe('año');
  });

  it('vacío, solo espacios, null y undefined son "Sin categoría"', () => {
    for (const raw of ['', '   ', '\t\n', null, undefined]) {
      expect(normalizeCategory(raw)).toEqual({ key: 'sin-categoria', label: 'Sin categoría' });
    }
  });

  it('devuelve el mismo resultado para el mismo texto (memoizado)', () => {
    expect(normalizeCategory('Transporte')).toBe(normalizeCategory('Transporte'));
  });
});
