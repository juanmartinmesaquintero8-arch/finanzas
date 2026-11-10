import { lowerCapitals, shortenCapitals } from './capital-recalc';

const sum = (xs: readonly bigint[]) => xs.reduce((a, b) => a + b, 0n);

describe('shortenCapitals (terminar antes)', () => {
  it('mantiene q, quedan ceil(B / q) cuotas y la última lleva el resto', () => {
    expect(shortenCapitals([100n, 100n, 100n, 100n, 100n], 250n)).toEqual([100n, 100n, 50n]);
    expect(shortenCapitals([100n, 100n, 100n], 200n)).toEqual([100n, 100n]);
    expect(shortenCapitals([100n, 100n, 100n], 1n)).toEqual([1n]);
  });
  it('B = 0 no deja cuotas', () => {
    expect(shortenCapitals([100n, 100n], 0n)).toEqual([]);
  });
  it('con cuotas distintas recorta desde el final sin subir ninguna', () => {
    expect(shortenCapitals([28n, 25n, 25n, 25n], 80n)).toEqual([28n, 25n, 25n, 2n]);
    expect(shortenCapitals([26n, 26n, 25n, 25n], 92n)).toEqual([26n, 26n, 25n, 15n]);
  });
  it('rechaza B mayor que lo que hay o negativo', () => {
    expect(() => shortenCapitals([1n], 2n)).toThrow();
    expect(() => shortenCapitals([1n], -1n)).toThrow();
  });
});

describe('lowerCapitals (bajar la cuota)', () => {
  it("q' = B ÷ n, r' = B mod n y las primeras r' llevan q' + 1", () => {
    expect(lowerCapitals([100n, 100n, 100n, 100n], 250n)).toEqual([63n, 63n, 62n, 62n]);
    expect(lowerCapitals([100n, 100n, 100n], 300n - 3n)).toEqual([99n, 99n, 99n]);
    expect(lowerCapitals([100n, 100n, 100n], 299n)).toEqual([100n, 100n, 99n]);
  });
  it('B = 0 no deja cuotas y las cuotas en cero desaparecen', () => {
    expect(lowerCapitals([100n, 100n], 0n)).toEqual([]);
    expect(lowerCapitals([100n, 100n, 100n], 2n)).toEqual([1n, 1n]);
  });
  it('con cuotas distintas ninguna cuota sube (tope de cada cuota)', () => {
    expect(lowerCapitals([28n, 25n, 25n, 25n], 102n)).toEqual([27n, 25n, 25n, 25n]);
    expect(lowerCapitals([10n, 10n, 10n, 1n], 30n)).toEqual([10n, 10n, 9n, 1n]);
  });
  it('rechaza B mayor que lo que hay', () => {
    expect(() => lowerCapitals([1n, 1n], 3n)).toThrow();
  });
});

describe('propiedades de los recálculos', () => {
  let seed = 987654321n;
  const next = (max: bigint): bigint => {
    seed = (seed * 6364136223846793005n + 1442695040888963407n) % (1n << 64n);
    return (seed >> 11n) % max;
  };
  const randomNonIncreasing = (): bigint[] => {
    const n = Number(next(72n)) + 1;
    const scale = [3n, 1000n, 10n ** 18n][Number(next(3n))];
    const xs: bigint[] = [];
    let cur = next(scale) + 1n;
    for (let i = 0; i < n; i++) {
      xs.push(cur);
      if (next(4n) === 0n) cur = next(cur + 1n);
    }
    return xs;
  };

  it('suman B, no suben ninguna cuota, no crecen hacia adelante y no dejan ceros', () => {
    let cases = 0;
    for (let i = 0; i < 2000; i++) {
      const old = randomNonIncreasing();
      const total = sum(old);
      const B = next(total + 1n);
      for (const result of [shortenCapitals(old, B), lowerCapitals(old, B)]) {
        expect(sum(result)).toBe(B);
        expect(result.length <= old.length).toBe(true);
        result.forEach((x, j) => {
          expect(x > 0n).toBe(true);
          expect(x <= old[j]).toBe(true);
          if (j > 0) expect(x <= result[j - 1]).toBe(true);
        });
        cases++;
      }
    }
    expect(cases).toBe(4000);
  });

  it('LOWER mantiene el número de cuotas mientras alcance para todas', () => {
    for (let i = 0; i < 500; i++) {
      const old = randomNonIncreasing().filter((x) => x > 0n);
      if (old.length === 0) continue;
      const B = BigInt(old.length) + next(sum(old) - BigInt(old.length) + 1n);
      if (B > sum(old)) continue;
      // Solo cuando cada cuota puede llevar al menos 1 sin pasarse de su tope.
      expect(lowerCapitals(old, B)).toHaveLength(old.length);
    }
  });
});
