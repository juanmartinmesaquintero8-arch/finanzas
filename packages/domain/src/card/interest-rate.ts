import { assertDomain } from '../shared/domain-validation.error';

export type RateBasis = 'MV' | 'EA';

/** 1 ppm = 0,0001 %. Topes: M.V. 10 %, E.A. 200 %. */
export const MAX_MV_PPM = 100_000;
export const MAX_EA_PPM = 2_000_000;
/** Por encima de esto una tasa M.V. parece una tasa anual escrita por error. */
export const ANNUAL_LOOKALIKE_MV_PPM = 40_000;

const PPM = 1_000_000n;
const SCALE = 10n ** 12n;

export interface InterestRateProps {
  basis: RateBasis;
  ppm: number;
}

/** Value Object: tasa de interés como entero en millonésimas (sin decimales de punto flotante). */
export class InterestRate {
  private constructor(
    readonly basis: RateBasis,
    readonly ppm: number,
  ) {}

  static create({ basis, ppm }: InterestRateProps): InterestRate {
    assertDomain(basis === 'MV' || basis === 'EA', 'La base de la tasa debe ser M.V. o E.A.');
    assertDomain(Number.isSafeInteger(ppm) && ppm > 0, 'La tasa debe ser un entero positivo');
    const cap = basis === 'MV' ? MAX_MV_PPM : MAX_EA_PPM;
    assertDomain(ppm <= cap, basis === 'MV' ? 'La tasa M.V. no puede superar 10 %' : 'La tasa E.A. no puede superar 200 %');
    return new InterestRate(basis, ppm);
  }

  /** Tasa mensual en ppm (entera). Para E.A. es la raíz doceava calculada solo con enteros. */
  get monthlyPpm(): number {
    return this.basis === 'MV' ? this.ppm : effectiveAnnualToMonthlyPpm(this.ppm);
  }
}

/** Mayor y tal que y^12 <= (S + EA·S/10^6)·S^11, con S = 10^12; luego ppm = (y − S + 500000) / 10^6. */
export function effectiveAnnualToMonthlyPpm(eaPpm: number): number {
  const target = (SCALE + (BigInt(eaPpm) * SCALE) / PPM) * SCALE ** 11n;
  let lo = SCALE;
  let hi = SCALE * 2n;
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    if (mid ** 12n <= target) lo = mid;
    else hi = mid - 1n;
  }
  return Number((lo - SCALE + 500_000n) / PPM);
}

/** Advertencia sin bloqueo: una M.V. de más de 4 % suele ser una tasa anual. */
export function looksLikeAnnualAsMonthly(rate: InterestRate): boolean {
  return rate.basis === 'MV' && rate.ppm > ANNUAL_LOOKALIKE_MV_PPM;
}

/** Texto de porcentaje ("1,87" o "1.87", máx. 4 decimales) a ppm, sin parseFloat. */
export function parseRatePercent(text: string): number {
  const match = /^(\d{1,9})(?:[.,](\d{1,4}))?$/.exec(text.trim());
  assertDomain(match !== null, 'Escribe la tasa con números y máximo 4 decimales, por ejemplo 1,87');
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(4, '0'));
  const ppm = whole * 10_000 + fraction;
  assertDomain(ppm > 0, 'La tasa debe ser mayor que cero');
  assertDomain(Number.isSafeInteger(ppm), 'La tasa es demasiado grande');
  return ppm;
}
