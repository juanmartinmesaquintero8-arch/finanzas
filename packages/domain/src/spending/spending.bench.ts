import { bench, describe } from 'vitest';
import { createSpendingAccumulator, type SpendingRow } from './accumulator';

const CATEGORIES = ['Mercado', 'Transporte', 'Educación', 'Salud', 'Ocio', 'Casa', 'Ropa', 'Café', null, '  ', 'Mascotas', 'Regalos'];
const TYPES = ['EXPENSE', 'EXPENSE', 'EXPENSE', 'INCOME', 'TRANSFER'] as const;

const rows: SpendingRow[] = Array.from({ length: 200_000 }, (_, i) => ({
  type: TYPES[i % TYPES.length]!,
  amount: BigInt(1000 + (i % 977) * 100),
  isoDate: `2026-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
  category: CATEGORIES[i % CATEGORIES.length] ?? null,
}));

// Presupuesto: 200.000 filas en menos de 150 ms (ver docs/diseno, §6.6).
describe('gasto por categoría', () => {
  bench('acumula 200.000 filas', () => {
    const acc = createSpendingAccumulator();
    for (const row of rows) acc.add(row);
    acc.result();
  });
});
