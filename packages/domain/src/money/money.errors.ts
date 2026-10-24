export class InvalidMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMoneyError';
  }
}

export class CurrencyMismatchError extends Error {
  constructor(a: string, b: string) {
    super(`No se pueden operar monedas distintas: ${a} y ${b}`);
    this.name = 'CurrencyMismatchError';
  }
}
