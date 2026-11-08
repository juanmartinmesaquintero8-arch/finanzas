import { normalizeCategory } from './category';
import type { MonthSpending } from './breakdown';

/** Fila cruda tal como se lee del almacenamiento: sin entidades, solo lo necesario. */
export interface SpendingRow {
  type: string;
  amount: bigint;
  /** ISO 8601; el mes son sus primeros 7 caracteres. */
  isoDate: string;
  category: string | null | undefined;
}

export interface SpendingResult {
  months: Map<string, MonthSpending>;
  /** Etiqueta a mostrar por clave de categoría: la grafía más usada. */
  labels: Map<string, string>;
}

export interface SpendingAccumulator {
  add(row: SpendingRow): void;
  result(): SpendingResult;
}

/** Suma los gastos (nunca ingresos ni traspasos) por mes y categoría, en una sola pasada. */
export function createSpendingAccumulator(): SpendingAccumulator {
  const months = new Map<string, MonthSpending>();
  // clave de categoría -> (grafía -> veces usada)
  const spellings = new Map<string, Map<string, number>>();

  return {
    add(row) {
      if (row.type !== 'EXPENSE') return;
      const { key, label } = normalizeCategory(row.category);
      const monthKey = row.isoDate.slice(0, 7);

      let month = months.get(monthKey);
      if (!month) {
        month = { total: 0n, byCategory: new Map() };
        months.set(monthKey, month);
      }
      month.total += row.amount;
      month.byCategory.set(key, (month.byCategory.get(key) ?? 0n) + row.amount);

      let counts = spellings.get(key);
      if (!counts) {
        counts = new Map();
        spellings.set(key, counts);
      }
      counts.set(label, (counts.get(label) ?? 0) + 1);
    },

    result() {
      const labels = new Map<string, string>();
      for (const [key, counts] of spellings) {
        let best = '';
        let bestCount = 0;
        // Con empate gana la que apareció primero (el Map conserva el orden de inserción).
        for (const [spelling, count] of counts) {
          if (count > bestCount) {
            best = spelling;
            bestCount = count;
          }
        }
        labels.set(key, best);
      }
      return { months, labels };
    },
  };
}
