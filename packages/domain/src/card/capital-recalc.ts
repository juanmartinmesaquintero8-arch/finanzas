import { assertDomain } from '../shared/domain-validation.error';

/*
 * Recálculo del capital de las cuotas que siguen cuando entra plata de más.
 * Entrada: capital de cada cuota restante (de la más próxima a la última, sin crecer hacia adelante)
 * y `B`, el capital que queda por repartir. Salida: capital de las cuotas que siguen existiendo;
 * las que quedan en cero desaparecen. Ninguna cuota queda por encima de lo que llevaba antes.
 */

function assertBalance(old: readonly bigint[], balance: bigint): void {
  const total = old.reduce((a, b) => a + b, 0n);
  assertDomain(balance >= 0n && balance <= total, 'La plata de más supera el capital pendiente');
}

/**
 * Terminar antes: cada cuota conserva su valor y se quitan desde el final.
 * Con cuotas iguales a `q`: quedan ceil(B / q) cuotas y la última lleva el resto (≤ q).
 */
export function shortenCapitals(old: readonly bigint[], balance: bigint): bigint[] {
  assertBalance(old, balance);
  const result: bigint[] = [];
  let rest = balance;
  for (const capital of old) {
    if (rest === 0n) break;
    const take = capital < rest ? capital : rest;
    result.push(take);
    rest -= take;
  }
  return result;
}

/**
 * Bajar la cuota: mismas cuotas, q' = B ÷ n y r' = B mod n; las primeras r' llevan q' + 1.
 * Si una cuota ya llevaba menos que ese nivel (por un recálculo anterior), conserva su valor
 * y el resto se reparte igual entre las demás, para que ninguna suba.
 */
export function lowerCapitals(old: readonly bigint[], balance: bigint): bigint[] {
  assertBalance(old, balance);
  const result = [...old];
  let rest = balance;
  let open = old.length;
  // Las cuotas del final son las más pequeñas: si no alcanzan el nivel parejo, se quedan como estaban.
  while (open > 0 && old[open - 1] <= rest / BigInt(open)) {
    rest -= old[open - 1];
    open--;
  }
  if (open > 0) {
    const q = rest / BigInt(open);
    const r = rest % BigInt(open);
    for (let j = 0; j < open; j++) result[j] = BigInt(j) < r ? q + 1n : q;
  }
  return result.filter((capital) => capital > 0n);
}
