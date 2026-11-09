export interface NormalizedCategory {
  /** Clave de agrupación: sin tildes en vocales, minúsculas, la ñ se conserva. */
  key: string;
  /** Texto limpio (sin espacios sobrantes) con la grafía original. */
  label: string;
}

export const UNCATEGORIZED_KEY = 'sin-categoria';
const UNCATEGORIZED: NormalizedCategory = Object.freeze({ key: UNCATEGORIZED_KEY, label: 'Sin categoría' });

const MARKS = /[̀-ͯ]/g;
const stripMarks = (s: string): string => s.normalize('NFD').replace(MARKS, '');

/** Tilde de las vocales fuera, pero "ñ" sigue siendo "ñ" (año ≠ ano). */
function toKey(text: string): string {
  return text.normalize('NFC').toLowerCase().split('ñ').map(stripMarks).join('ñ');
}

// Las categorías se repiten miles de veces: se calcula una vez por texto. Tope para no crecer sin fin.
const CACHE_LIMIT = 5000;
const cache = new Map<string, NormalizedCategory>();

export function normalizeCategory(raw: string | null | undefined): NormalizedCategory {
  if (raw == null) return UNCATEGORIZED;
  const hit = cache.get(raw);
  if (hit) return hit;
  const label = raw.replace(/\s+/g, ' ').trim();
  const value: NormalizedCategory = label === '' ? UNCATEGORIZED : { key: toKey(label), label: label.normalize('NFC') };
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(raw, value);
  return value;
}
