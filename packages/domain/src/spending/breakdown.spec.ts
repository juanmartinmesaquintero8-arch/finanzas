import { describe, expect, it } from 'vitest';
import { buildBreakdown, type MonthSpending } from './breakdown';

const month = (entries: Record<string, bigint>): MonthSpending => ({
  total: Object.values(entries).reduce((a, b) => a + b, 0n),
  byCategory: new Map(Object.entries(entries)),
});
const labels = (keys: string[]) => new Map(keys.map((k) => [k, k === 'sin-categoria' ? 'Sin categoría' : k[0]!.toUpperCase() + k.slice(1)]));

describe('buildBreakdown', () => {
  it('sin gastos no hay filas', () => {
    expect(buildBreakdown(month({}), undefined, new Map())).toMatchObject({ total: 0n, rows: [] });
  });

  it('muestra las 5 mayores, luego Sin categoría y al final Otras con el resto (máximo 7 filas)', () => {
    const cur = month({ a: 900n, b: 800n, c: 700n, d: 600n, e: 500n, f: 400n, g: 300n, 'sin-categoria': 100n });
    const out = buildBreakdown(cur, undefined, labels(Object.keys(Object.fromEntries(cur.byCategory))));
    expect(out.rows.map((r) => r.key)).toEqual(['a', 'b', 'c', 'd', 'e', 'sin-categoria', '__otras__']);
    expect(out.rows.map((r) => r.kind)).toEqual(['category', 'category', 'category', 'category', 'category', 'uncategorized', 'other']);
    expect(out.rows.at(-1)?.amount).toBe(700n); // f + g
    expect(out.rows.at(-1)?.label).toBe('Otras');
    expect(out.rows.length).toBeLessThanOrEqual(7);
  });

  it('Sin categoría no compite por los 5 lugares y Otras no aparece si no sobra nada', () => {
    const cur = month({ a: 10n, b: 9n, 'sin-categoria': 1000n });
    const out = buildBreakdown(cur, undefined, labels(['a', 'b', 'sin-categoria']));
    expect(out.rows.map((r) => r.key)).toEqual(['a', 'b', 'sin-categoria']);
  });

  it('empates se ordenan por nombre para que el resultado sea estable', () => {
    const cur = month({ zeta: 5n, alfa: 5n });
    expect(buildBreakdown(cur, undefined, labels(['zeta', 'alfa'])).rows.map((r) => r.key)).toEqual(['alfa', 'zeta']);
  });

  it('porcentajes enteros del gasto y barras relativas a la mayor fila', () => {
    const cur = month({ a: 800n, b: 400n, c: 800n });
    const out = buildBreakdown(cur, undefined, labels(['a', 'b', 'c']));
    expect(out.rows.map((r) => r.key)).toEqual(['a', 'c', 'b']);
    expect(out.rows.map((r) => r.percent)).toEqual([40, 40, 20]);
    expect(out.rows.map((r) => r.barPct)).toEqual([100, 100, 50]);
  });

  it('la barra de Otras se mide contra la mayor fila, aunque Otras sea la mayor', () => {
    const cur = month({ a: 10n, b: 10n, c: 10n, d: 10n, e: 10n, f: 40n, g: 40n, h: 10n });
    const out = buildBreakdown(cur, undefined, labels(Object.keys(Object.fromEntries(cur.byCategory))));
    const otras = out.rows.find((r) => r.kind === 'other')!;
    expect(otras.amount).toBe(30n);
    expect(Math.max(...out.rows.map((r) => r.barPct))).toBe(100);
    expect(otras.barPct).toBe(75);
  });

  it('compara cada fila con el mes anterior: más, menos, igual y nueva', () => {
    const cur = month({ mercado: 820n, ocio: 100n, salud: 50n, ropa: 70n });
    const prev = month({ mercado: 730n, ocio: 120n, salud: 50n });
    const out = buildBreakdown(cur, prev, labels(['mercado', 'ocio', 'salud', 'ropa']));
    const by = Object.fromEntries(out.rows.map((r) => [r.key, r]));
    expect(by.mercado).toMatchObject({ delta: 90n, previousAmount: 730n, isNew: false });
    expect(by.ocio).toMatchObject({ delta: -20n, isNew: false });
    expect(by.salud).toMatchObject({ delta: 0n, isNew: false });
    expect(by.ropa).toMatchObject({ delta: 70n, previousAmount: 0n, isNew: true });
  });

  it('la marca del mes anterior se ubica en la misma escala de la barra y no pasa de 100', () => {
    const cur = month({ a: 1000n, b: 500n });
    const prev = month({ a: 2000n, b: 250n });
    const out = buildBreakdown(cur, prev, labels(['a', 'b']));
    expect(out.rows[0]?.previousMarkPct).toBe(100);
    expect(out.rows[1]?.previousMarkPct).toBe(25);
  });

  it('sin mes anterior no hay comparación ni marca', () => {
    const out = buildBreakdown(month({ a: 5n }), undefined, labels(['a']));
    expect(out.rows[0]).toMatchObject({ previousMarkPct: null, delta: null, isNew: false });
    expect(out.previousTotal).toBeUndefined();
  });

  it('Otras se compara con la suma del mes anterior de las categorías que agrupa', () => {
    const cur = month({ a: 60n, b: 50n, c: 40n, d: 30n, e: 20n, f: 10n, g: 5n });
    const prev = month({ a: 60n, b: 50n, c: 40n, d: 30n, e: 20n, f: 4n, g: 1n, zzz: 999n });
    const out = buildBreakdown(cur, prev, labels(Object.keys(Object.fromEntries(cur.byCategory))));
    const otras = out.rows.find((r) => r.kind === 'other')!;
    expect(otras.amount).toBe(15n);
    expect(otras.previousAmount).toBe(5n);
    expect(otras.delta).toBe(10n);
  });

  it('el total del mes anterior se informa aparte', () => {
    const out = buildBreakdown(month({ a: 5n }), month({ a: 3n, b: 4n }), labels(['a']));
    expect(out.total).toBe(5n);
    expect(out.previousTotal).toBe(7n);
  });

  it('conserva montos enormes (mayores que Number.MAX_SAFE_INTEGER) sin perder precisión', () => {
    const big = 9_007_199_254_740_993n;
    const out = buildBreakdown(month({ a: big, b: big + 2n }), month({ a: big - 1n }), labels(['a', 'b']));
    expect(out.rows.find((r) => r.key === 'a')).toMatchObject({ amount: big, delta: 1n, previousAmount: big - 1n });
    expect(out.rows.find((r) => r.key === 'b')?.amount).toBe(big + 2n);
    expect(out.total).toBe(2n * big + 2n);
  });
});
