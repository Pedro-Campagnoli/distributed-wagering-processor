import { describe, expect, it } from 'bun:test';
import {
  InvalidTransactionStateError,
  LedgerDirectionUnavailableError,
  MissingTransactionReferenceError,
} from './errors.js';
import { Money } from './money.js';
import {
  CreateWagerTransactionProps,
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from './wager-transaction.js';
import { LedgerDirection } from './wallet-ledger-entry.js';

function createTransaction(
  overrides: Partial<CreateWagerTransactionProps> = {},
): WagerTransaction {
  return WagerTransaction.create({
    id: 'transaction-1',
    providerId: 'provider-1',
    externalTransactionId: 'external-1',
    idempotencyKey: 'idempotency-1',
    payloadHash: 'hash-1',
    walletId: 'wallet-1',
    playerId: 'player-1',
    roundId: 'round-1',
    gameId: 'game-1',
    kind: WagerTransactionKind.Bet,
    money: Money.from({
      amount: '25.00',
      currency: 'BRL',
    }),
    ...overrides,
  });
}

describe('WagerTransaction', () => {
  describe('creation', () => {
    it('creates a pending bet transaction', () => {
      const money = Money.from({
        amount: '25.00',
        currency: 'BRL',
      });

      const transaction = WagerTransaction.create({
        id: 'transaction-1',
        providerId: 'provider-1',
        externalTransactionId: 'external-1',
        idempotencyKey: 'idempotency-1',
        payloadHash: 'hash-1',
        walletId: 'wallet-1',
        playerId: 'player-1',
        roundId: 'round-1',
        gameId: 'game-1',
        kind: WagerTransactionKind.Bet,
        money,
      });

      expect(transaction.id).toBe('transaction-1');
      expect(transaction.providerId).toBe('provider-1');
      expect(transaction.externalTransactionId).toBe('external-1');
      expect(transaction.idempotencyKey).toBe('idempotency-1');
      expect(transaction.payloadHash).toBe('hash-1');
      expect(transaction.walletId).toBe('wallet-1');
      expect(transaction.playerId).toBe('player-1');
      expect(transaction.roundId).toBe('round-1');
      expect(transaction.gameId).toBe('game-1');
      expect(transaction.kind).toBe(WagerTransactionKind.Bet);
      expect(transaction.money).toBe(money);

      expect(transaction.status).toBe(WagerTransactionStatus.Pending);
      expect(transaction.referenceExternalTransactionId).toBeUndefined();
      expect(transaction.referenceTransactionId).toBeUndefined();
      expect(transaction.failureCode).toBeUndefined();
      expect(transaction.processedAt).toBeUndefined();
      expect(transaction.createdAt).toBeInstanceOf(Date);
    });

    it('creates a refund transaction with an external reference', () => {
      const transaction = createTransaction({
        externalTransactionId: 'refund-1',
        kind: WagerTransactionKind.Refund,
        referenceExternalTransactionId: 'bet-1',
      });

      expect(transaction.kind).toBe(WagerTransactionKind.Refund);
      expect(transaction.referenceExternalTransactionId).toBe('bet-1');
      expect(transaction.status).toBe(WagerTransactionStatus.Pending);
    });

    it('creates a rollback transaction with an external reference', () => {
      const transaction = createTransaction({
        externalTransactionId: 'rollback-1',
        kind: WagerTransactionKind.Rollback,
        referenceExternalTransactionId: 'bet-1',
      });

      expect(transaction.kind).toBe(WagerTransactionKind.Rollback);
      expect(transaction.referenceExternalTransactionId).toBe('bet-1');
    });

    it('rejects a refund without an external reference', () => {
      expect(() =>
        createTransaction({
          kind: WagerTransactionKind.Refund,
        }),
      ).toThrow(MissingTransactionReferenceError);
    });

    it('rejects a rollback without an external reference', () => {
      expect(() =>
        createTransaction({
          kind: WagerTransactionKind.Rollback,
        }),
      ).toThrow(MissingTransactionReferenceError);
    });

    it('allows a win without an external reference', () => {
      const transaction = createTransaction({
        externalTransactionId: 'win-1',
        kind: WagerTransactionKind.Win,
      });

      expect(transaction.referenceExternalTransactionId).toBeUndefined();
    });
  });

  describe('state transition', () => {
    it('marks a pending transaction as pending reference', () => {
      const transaction = createTransaction({
        externalTransactionId: 'refund-1',
        kind: WagerTransactionKind.Refund,
        referenceExternalTransactionId: 'bet-1',
      });

      transaction.markPendingReference();

      expect(transaction.status).toBe(WagerTransactionStatus.PendingReference);
    });

    it('marks a pending transaction as processed', () => {
      const transaction = createTransaction({
        externalTransactionId: 'bet-1',
      });

      const processedAt = new Date('2020-01-01T00:00:00.000Z');

      transaction.markProcessed(undefined, processedAt);

      expect(transaction.status).toBe(WagerTransactionStatus.Processed);
      expect(transaction.processedAt).toEqual(processedAt);
      expect(transaction.referenceTransactionId).toBeUndefined();
      expect(transaction.failureCode).toBeUndefined();
    });

    it('marks a pending reference transaction as processed', () => {
      const transaction = createTransaction({
        externalTransactionId: 'refund-1',
        kind: WagerTransactionKind.Refund,
        referenceExternalTransactionId: 'bet-1',
      });

      transaction.markPendingReference();

      const processedAt = new Date('2020-01-01T00:00:00.000Z');

      transaction.markProcessed('internal-bet-transaction-1', processedAt);

      expect(transaction.status).toBe(WagerTransactionStatus.Processed);
      expect(transaction.referenceTransactionId).toBe(
        'internal-bet-transaction-1',
      );
      expect(transaction.processedAt).toEqual(processedAt);
    });

    it('rejects a pending transaction', () => {
      const transaction = createTransaction({
        externalTransactionId: 'bet-1',
      });

      transaction.reject('INSUFFICIENT_BALANCE');

      expect(transaction.status).toBe(WagerTransactionStatus.Rejected);
      expect(transaction.failureCode).toBe('INSUFFICIENT_BALANCE');
      expect(transaction.processedAt).toBeUndefined();
    });

    it('fails a pending transaction', () => {
      const transaction = createTransaction({
        externalTransactionId: 'bet-1',
      });

      transaction.fail('PROCESSING_FAILURE');

      expect(transaction.status).toBe(WagerTransactionStatus.Failed);
      expect(transaction.failureCode).toBe('PROCESSING_FAILURE');
      expect(transaction.processedAt).toBeUndefined();
    });
  });

  describe('terminal states', () => {
    it('does not allow transitions from a processed transaction', () => {
      const transaction = createTransaction();

      transaction.markProcessed(
        undefined,
        new Date('2020-01-01T00:00:00.000Z'),
      );

      expect(() => transaction.reject('SOME_FAILURE')).toThrow(
        InvalidTransactionStateError,
      );
    });

    it('does not allow transitions from a rejected transaction', () => {
      const transaction = createTransaction();

      transaction.reject('INSUFFICIENT_BALANCE');

      expect(() =>
        transaction.markProcessed(
          undefined,
          new Date('2020-01-01T00:00:00.000Z'),
        ),
      ).toThrow(InvalidTransactionStateError);
    });

    it('does not allow transitions from a failed transaction', () => {
      const transaction = createTransaction();

      transaction.fail('PROCESSING_FAILURE');

      expect(() => transaction.markPendingReference()).toThrow(
        InvalidTransactionStateError,
      );
    });

    it('does not allow marking a pending reference transaction again', () => {
      const transaction = createTransaction({
        kind: WagerTransactionKind.Refund,
        referenceExternalTransactionId: 'bet-1',
      });

      transaction.markPendingReference();

      expect(() => transaction.markPendingReference()).toThrow(
        InvalidTransactionStateError,
      );
    });

    it('does not allow a bet to become pending reference', () => {
      const transaction = createTransaction();

      expect(() => transaction.markPendingReference()).toThrow(
        InvalidTransactionStateError,
      );
    });

    it('identifies terminal statuses', () => {
      const processed = WagerTransaction.rehydrate({
        id: 'transaction-1',
        providerId: 'provider-1',
        externalTransactionId: 'external-1',
        idempotencyKey: 'idempotency-1',
        payloadHash: 'hash-1',
        walletId: 'wallet-1',
        playerId: 'player-1',
        roundId: 'round-1',
        gameId: 'game-1',
        kind: WagerTransactionKind.Bet,
        money: Money.from({
          amount: '25.00',
          currency: 'BRL',
        }),
        createdAt: new Date('2020-01-01T00:00:00.000Z'),
        status: WagerTransactionStatus.Processed,
        processedAt: new Date('2020-01-01T00:01:00.000Z'),
      });

      expect(processed.isTerminal()).toBe(true);
    });
  });

  describe('affectsBalance', () => {
    it.each([
      [WagerTransactionKind.Opening, true],
      [WagerTransactionKind.Bet, true],
      [WagerTransactionKind.Win, true],
      [WagerTransactionKind.Loss, false],
      [WagerTransactionKind.Refund, true],
      [WagerTransactionKind.Rollback, true],
    ])('%s affects balance as expected', (kind, expected) => {
      const transaction = WagerTransaction.create({
        id: 'transaction-1',
        providerId: 'provider-1',
        externalTransactionId: 'external-1',
        idempotencyKey: 'idempotency-1',
        payloadHash: 'hash-1',
        walletId: 'wallet-1',
        playerId: 'player-1',
        roundId: 'round-1',
        gameId: 'game-1',
        kind,
        money: Money.from({
          amount: '25.00',
          currency: 'BRL',
        }),
        ...(kind === WagerTransactionKind.Refund ||
        kind === WagerTransactionKind.Rollback
          ? { referenceExternalTransactionId: 'reference-1' }
          : {}),
      });

      expect(transaction.affectsBalance()).toBe(expected);
    });
  });

  describe('requiresReference', () => {
    it.each([
      [WagerTransactionKind.Opening, false],
      [WagerTransactionKind.Bet, false],
      [WagerTransactionKind.Win, false],
      [WagerTransactionKind.Loss, false],
      [WagerTransactionKind.Refund, true],
      [WagerTransactionKind.Rollback, true],
    ])('%s reference requirement is correct', (kind, expected) => {
      const transaction = createTransaction({
        kind,
        ...(kind === WagerTransactionKind.Refund ||
        kind === WagerTransactionKind.Rollback
          ? { referenceExternalTransactionId: 'reference-1' }
          : {}),
      });

      expect(transaction.requiresReference()).toBe(expected);
    });
  });

  describe('matchesPayload', () => {
    it('returns true when payload hash matches', () => {
      const transaction = createTransaction();

      expect(transaction.matchesPayload('hash-1')).toBe(true);
    });

    it('returns false when payload hash does not match', () => {
      const transaction = createTransaction();

      expect(transaction.matchesPayload('different-hash')).toBe(false);
    });
  });

  describe('ledgerDirectionFor', () => {
    it.each([
      [WagerTransactionKind.Opening, LedgerDirection.Credit],
      [WagerTransactionKind.Bet, LedgerDirection.Debit],
      [WagerTransactionKind.Win, LedgerDirection.Credit],
      [WagerTransactionKind.Refund, LedgerDirection.Credit],
    ])('returns the correct ledger direction for %s', (kind, expected) => {
      const transaction = createTransaction({
        kind,
        ...(kind === WagerTransactionKind.Refund
          ? { referenceExternalTransactionId: 'reference-1' }
          : {}),
      });

      expect(transaction.ledgerDirectionFor()).toBe(expected);
    });

    it('does not provide a ledger direction for loss', () => {
      const transaction = createTransaction({
        kind: WagerTransactionKind.Loss,
      });

      expect(() => transaction.ledgerDirectionFor()).toThrow(
        LedgerDirectionUnavailableError,
      );
    });

    it.each([
      [WagerTransactionKind.Bet, LedgerDirection.Credit],
      [WagerTransactionKind.Win, LedgerDirection.Debit],
      [WagerTransactionKind.Refund, LedgerDirection.Debit],
    ])(
      'returns the correct ledger direction when rolling back %s',
      (referenceKind, expected) => {
        const transaction = createTransaction({
          kind: WagerTransactionKind.Rollback,
          referenceExternalTransactionId: 'reference-1',
        });

        const reference = createTransaction({
          id: 'reference-transaction-1',
          externalTransactionId: 'reference-1',
          kind: referenceKind,
          ...(referenceKind === WagerTransactionKind.Refund
            ? { referenceExternalTransactionId: 'bet-1' }
            : {}),
        });

        expect(transaction.ledgerDirectionFor(reference)).toBe(expected);
      },
    );

    it('rejects an invalid rollback reference kind', () => {
      const transaction = createTransaction({
        kind: WagerTransactionKind.Rollback,
        referenceExternalTransactionId: 'loss-1',
      });

      const reference = createTransaction({
        id: 'reference-transaction-1',
        externalTransactionId: 'loss-1',
        kind: WagerTransactionKind.Loss,
      });

      expect(() => transaction.ledgerDirectionFor(reference)).toThrow(
        LedgerDirectionUnavailableError,
      );
    });

    it('rejects rollback without a resolved reference', () => {
      const transaction = createTransaction({
        kind: WagerTransactionKind.Rollback,
        referenceExternalTransactionId: 'reference-1',
      });

      expect(() => transaction.ledgerDirectionFor()).toThrow(
        LedgerDirectionUnavailableError,
      );
    });
  });

  describe('rehydration', () => {
    it('restores a persisted transaction state', () => {
      const money = Money.from({
        amount: '25.00',
        currency: 'BRL',
      });

      const createdAt = new Date('2020-01-01T00:00:00.000Z');
      const processedAt = new Date('2020-01-01T00:01:00.000Z');

      const transaction = WagerTransaction.rehydrate({
        id: 'transaction-1',
        providerId: 'provider-1',
        externalTransactionId: 'refund-1',
        idempotencyKey: 'idempotency-1',
        payloadHash: 'hash-1',
        walletId: 'wallet-1',
        playerId: 'player-1',
        roundId: 'round-1',
        gameId: 'game-1',
        kind: WagerTransactionKind.Refund,
        money,
        referenceExternalTransactionId: 'bet-1',
        createdAt,
        status: WagerTransactionStatus.Processed,
        referenceTransactionId: 'transaction-reference-1',
        processedAt,
      });

      expect(transaction.id).toBe('transaction-1');
      expect(transaction.providerId).toBe('provider-1');
      expect(transaction.externalTransactionId).toBe('refund-1');
      expect(transaction.idempotencyKey).toBe('idempotency-1');
      expect(transaction.payloadHash).toBe('hash-1');
      expect(transaction.walletId).toBe('wallet-1');
      expect(transaction.playerId).toBe('player-1');
      expect(transaction.roundId).toBe('round-1');
      expect(transaction.gameId).toBe('game-1');
      expect(transaction.kind).toBe(WagerTransactionKind.Refund);
      expect(transaction.money).toBe(money);
      expect(transaction.referenceExternalTransactionId).toBe('bet-1');
      expect(transaction.createdAt).toBe(createdAt);

      expect(transaction.status).toBe(WagerTransactionStatus.Processed);
      expect(transaction.referenceTransactionId).toBe(
        'transaction-reference-1',
      );
      expect(transaction.failureCode).toBeUndefined();
      expect(transaction.processedAt).toBe(processedAt);
    });
  });
});
