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

export class ExternalOpeningTransactionError extends Error {
  constructor() {
    super('OPENING transactions cannot be submitted externally');
    this.name = 'ExternalOpeningTransactionError';
  }
}

export class WalletNotFoundError extends Error {
  constructor(walletId: string) {
    super(`Wallet not found: ${walletId}`);
    this.name = 'WalletNotFoundError';
  }
}

export class WagerTransactionNotFoundError extends Error {
  constructor() {
    super('Wager transaction not found');
    this.name = 'WagerTransactionNotFoundError';
  }
}

export class InvalidLedgerCursorError extends Error {
  constructor() {
    super('Invalid ledger cursor');
    this.name = 'InvalidLedgerCursorError';
  }
}

export class WalletPlayerMismatchError extends Error {
  constructor() {
    super('Wallet does not belong to the transaction player');
    this.name = 'WalletPlayerMismatchError';
  }
}

export class IdempotencyConflictError extends Error {
  constructor(idempotencyKey: string) {
    super(`Idempotency key reused with different payload: ${idempotencyKey}`);
    this.name = 'IdempotencyConflictError';
  }
}

export class DuplicateRefundError extends Error {
  constructor(referenceExternalTransactionId: string) {
    super(`BET already refunded: ${referenceExternalTransactionId}`);
    this.name = 'DuplicateRefundError';
  }
}

export class DuplicateRollbackError extends Error {
  constructor(referenceExternalTransactionId: string) {
    super(`Transaction already rolled back: ${referenceExternalTransactionId}`);
    this.name = 'DuplicateRollbackError';
  }
}
