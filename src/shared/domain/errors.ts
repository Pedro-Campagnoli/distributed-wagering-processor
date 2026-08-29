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

export class InsufficientBalanceError extends Error {
  constructor() {
    super('Insufficient wallet balance');
    this.name = 'InsufficientBalanceError';
  }
}

export class UnbalancedLedgerEntryError extends Error {
  constructor() {
    super('Ledger entry balance is inconsistent');
    this.name = 'UnbalancedLedgerEntryError';
  }
}

export class InvalidLedgerAmountError extends Error {
  constructor() {
    super('Ledger entry amount must be greater than zero');
    this.name = 'InvalidLedgerAmountError';
  }
}

export class MissingTransactionReferenceError extends Error {
  constructor() {
    super('Transaction reference is required');
    this.name = 'MissingTransactionReferenceError';
  }
}

export class InvalidTransactionStateError extends Error {
  constructor(currentStatus: string, transition: string) {
    super(`Cannot ${transition} transaction from status ${currentStatus}`);

    this.name = 'InvalidTransactionStateError';
  }
}

export class LedgerDirectionUnavailableError extends Error {
  constructor() {
    super('Ledger direction is unavailable for this transaction');
    this.name = 'LedgerDirectionUnavailableError';
  }
}
