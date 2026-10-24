import { InvalidMoneyError, Money } from '@finanzas/domain';

const INTEGER = /^-?\d+$/;

/** Convierte el monto recibido por JSON (string de entero en unidades mínimas) a Money. */
export function parseMoney(raw: string | number | bigint, currency: string): Money {
  const text = String(raw).trim();
  if (!INTEGER.test(text)) {
    throw new InvalidMoneyError(`El monto debe ser un entero en unidades mínimas: ${text}`);
  }
  return Money.of(BigInt(text), currency);
}
