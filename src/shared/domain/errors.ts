export class InvalidMoneyAmountError extends Error {
  constructor(amount: string) {
    super(`Invalid money amount: ${amount}`);
    this.name = 'InvalidMoneyAmountError';
  }
}

export class InvalidCurrencyError extends Error {
  constructor(currency: string) {
    super(`Invalid currency: ${currency}`);
    this.name = 'InvalidCurrencyError';
  }
}

export class CurrencyMismatchError extends Error {
  constructor(left: string, right: string) {
    super(`Currency mismatch: ${left} !== ${right}`);
    this.name = 'CurrencyMismatchError';
  }
}
