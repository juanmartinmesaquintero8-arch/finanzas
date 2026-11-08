import { UNCATEGORIZED_KEY } from './category';

export interface MonthSpending {
  total: bigint;
  /** clave de categoría -> total gastado */
  byCategory: Map<string, bigint>;
}

export type BreakdownKind = 'category' | 'uncategorized' | 'other';

export interface BreakdownRow {
  key: string;
  label: string;
  kind: BreakdownKind;
  amount: bigint;
  /** Parte del gasto del mes, entera. Solo para mostrar: ningún cálculo de dinero la usa. */
  percent: number;
  /** Largo de la barra (0 a 100) respecto de la fila mayor. */
  barPct: number;
  /** Gasto de esta fila en el mes de comparación; null si no hay mes con qué comparar. */
  previousAmount: bigint | null;
  /** Posición (0 a 100) de la marca del mes anterior sobre la misma escala; null si no aplica. */
  previousMarkPct: number | null;
  /** amount - previousAmount; null si no hay con qué comparar. */
  delta: bigint | null;
  /** Hubo comparación y esta fila no gastó nada en el mes anterior. */
  isNew: boolean;
}

export interface Breakdown {
  total: bigint;
  previousTotal: bigint | undefined;
  rows: BreakdownRow[];
}

export const OTHERS_KEY = '__otras__';
export const OTHERS_LABEL = 'Otras';
export const UNCATEGORIZED_LABEL = 'Sin categoría';
export const TOP_CATEGORIES = 5;

/** Cociente redondeado al más cercano, para mostrar: (100 * part / whole) sin salir de bigint. */
const roundedPercent = (part: bigint, whole: bigint): number => Number((part * 200n + whole) / (2n * whole));
/** Décimas de porcentaje truncadas, limitado a 100. */
const scale = (part: bigint, max: bigint): number => Math.min(100, Number((part * 1000n) / max) / 10);

interface Draft {
  key: string;
  label: string;
  kind: BreakdownKind;
  amount: bigint;
  previousAmount: bigint;
}

/**
 * Reparte el gasto de un mes en filas: las 5 categorías mayores, "Sin categoría" como fila
 * propia si existe y "Otras" con el resto (máximo 7 filas). Compara cada fila con `previous`
 * (que ya viene recortado a los mismos días cuando el mes está en curso).
 */
export function buildBreakdown(current: MonthSpending, previous: MonthSpending | undefined, labels: ReadonlyMap<string, string>): Breakdown {
  const total = current.total;
  const prevOf = (key: string): bigint => previous?.byCategory.get(key) ?? 0n;

  const named: { key: string; amount: bigint }[] = [];
  let uncategorized = 0n;
  for (const [key, amount] of current.byCategory) {
    if (key === UNCATEGORIZED_KEY) uncategorized = amount;
    else named.push({ key, amount });
  }
  named.sort((a, b) => (a.amount === b.amount ? (a.key < b.key ? -1 : 1) : a.amount > b.amount ? -1 : 1));

  const drafts: Draft[] = named.slice(0, TOP_CATEGORIES).map(({ key, amount }) => ({
    key,
    label: labels.get(key) ?? key,
    kind: 'category',
    amount,
    previousAmount: prevOf(key),
  }));
  if (uncategorized > 0n) {
    drafts.push({
      key: UNCATEGORIZED_KEY,
      label: UNCATEGORIZED_LABEL,
      kind: 'uncategorized',
      amount: uncategorized,
      previousAmount: prevOf(UNCATEGORIZED_KEY),
    });
  }
  const rest = named.slice(TOP_CATEGORIES);
  if (rest.length > 0) {
    drafts.push({
      key: OTHERS_KEY,
      label: OTHERS_LABEL,
      kind: 'other',
      amount: rest.reduce((sum, r) => sum + r.amount, 0n),
      previousAmount: rest.reduce((sum, r) => sum + prevOf(r.key), 0n),
    });
  }

  const max = drafts.reduce((m, d) => (d.amount > m ? d.amount : m), 0n);
  const rows: BreakdownRow[] = drafts.map((d) => {
    const compared = previous !== undefined;
    return {
      key: d.key,
      label: d.label,
      kind: d.kind,
      amount: d.amount,
      percent: roundedPercent(d.amount, total),
      barPct: scale(d.amount, max),
      previousAmount: compared ? d.previousAmount : null,
      previousMarkPct: compared && d.previousAmount > 0n ? scale(d.previousAmount, max) : null,
      delta: compared ? d.amount - d.previousAmount : null,
      isNew: compared && d.previousAmount === 0n,
    };
  });

  return { total, previousTotal: previous?.total, rows };
}
