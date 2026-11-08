import { describe, expect, it } from 'vitest';
import { createSpendingAccumulator, type SpendingRow } from './accumulator';

const row = (over: Partial<SpendingRow> = {}): SpendingRow => ({
  type: 'EXPENSE',
  amount: 1000n,
  isoDate: '2026-10-15T00:00:00.000Z',
  category: 'Mercado',
  ...over,
});

describe('createSpendingAccumulator', () => {
  it('suma solo gastos, por mes y por categoría', () => {
    const acc = createSpendingAccumulator();
    acc.add(row({ amount: 100n }));
    acc.add(row({ amount: 50n, category: 'Transporte' }));
    acc.add(row({ amount: 25n, isoDate: '2026-11-02T00:00:00.000Z' }));
    const { months } = acc.result();
    expect(months.get('2026-10')?.total).toBe(150n);
    expect(months.get('2026-10')?.byCategory.get('mercado')).toBe(100n);
    expect(months.get('2026-10')?.byCategory.get('transporte')).toBe(50n);
    expect(months.get('2026-11')?.total).toBe(25n);
  });

  it('ignora ingresos y traspasos entre cuentas', () => {
    const acc = createSpendingAccumulator();
    acc.add(row({ type: 'INCOME', amount: 999n }));
    acc.add(row({ type: 'TRANSFER', amount: 888n }));
    acc.add(row({ amount: 7n }));
    expect(acc.result().months.get('2026-10')?.total).toBe(7n);
    expect([...acc.result().months.keys()]).toEqual(['2026-10']);
  });

  it('une grafías distintas de una misma categoría y muestra la más usada', () => {
    const acc = createSpendingAccumulator();
    acc.add(row({ category: 'Educacion', amount: 1n }));
    acc.add(row({ category: 'Educación', amount: 1n }));
    acc.add(row({ category: ' educación ', amount: 1n }));
    acc.add(row({ category: 'Educación', amount: 1n }));
    const r = acc.result();
    expect(r.months.get('2026-10')?.byCategory.get('educacion')).toBe(4n);
    expect(r.labels.get('educacion')).toBe('Educación');
  });

  it('"año" y "ano" quedan separadas', () => {
    const acc = createSpendingAccumulator();
    acc.add(row({ category: 'Año', amount: 5n }));
    acc.add(row({ category: 'Ano', amount: 3n }));
    const by = acc.result().months.get('2026-10')!.byCategory;
    expect(by.get('año')).toBe(5n);
    expect(by.get('ano')).toBe(3n);
  });

  it('sin categoría (vacía o null) va a su propia clave', () => {
    const acc = createSpendingAccumulator();
    acc.add(row({ category: null, amount: 4n }));
    acc.add(row({ category: '  ', amount: 6n }));
    const r = acc.result();
    expect(r.months.get('2026-10')?.byCategory.get('sin-categoria')).toBe(10n);
    expect(r.labels.get('sin-categoria')).toBe('Sin categoría');
  });

  it('suma montos mayores que Number.MAX_SAFE_INTEGER sin perder un solo peso', () => {
    const big = 9_007_199_254_740_993n; // MAX_SAFE_INTEGER + 2
    const acc = createSpendingAccumulator();
    acc.add(row({ amount: big }));
    acc.add(row({ amount: big }));
    acc.add(row({ amount: 1n }));
    expect(acc.result().months.get('2026-10')?.total).toBe(big * 2n + 1n);
  });
});
