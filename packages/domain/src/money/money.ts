import { CurrencyMismatchError, InvalidMoneyError } from './money.errors';

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/** Value Object inmutable: monto en unidades mínimas enteras + moneda ISO 4217. */
export class Money {
  private constructor(
    readonly amount: bigint,
    readonly currency: string,
  ) {}

  static of(amount: bigint | number, currency: string): Money {
    if (!CURRENCY_PATTERN.test(currency)) {
      throw new InvalidMoneyError(`Moneda inválida: ${currency}`);
    }
    if (typeof amount === 'number' && !Number.isSafeInteger(amount)) {
      throw new InvalidMoneyError(`El monto debe ser un entero en unidades mínimas: ${amount}`);
    }
    return new Money(BigInt(amount), currency);
  }

  static zero(currency: string): Money {
    return Money.of(0n, currency);
  }

  static sum(items: readonly Money[], currency: string): Money {
    return items.reduce((acc, m) => acc.add(m), Money.zero(currency));
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount + other.amount, this.currency);
  }

  subtract(other: Money): Money {
    return this.add(other.negate());
  }

  negate(): Money {
    return new Money(-this.amount, this.currency);
  }

  multiply(factor: number): Money {
    if (!Number.isSafeInteger(factor)) {
      throw new InvalidMoneyError(`El factor debe ser entero: ${factor}`);
    }
    return new Money(this.amount * BigInt(factor), this.currency);
  }

  isZero(): boolean {
    return this.amount === 0n;
  }

  isNegative(): boolean {
    return this.amount < 0n;
  }

  isPositive(): boolean {
    return this.amount > 0n;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amount === other.amount;
  }

  greaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount > other.amount;
  }

  toJSON(): { amount: string; currency: string } {
    return { amount: this.amount.toString(), currency: this.currency };
  }

  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}
