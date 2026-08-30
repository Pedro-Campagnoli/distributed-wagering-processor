import { describe, expect, test } from 'bun:test';

import { ExternalOpeningTransactionError } from '../../domain/errors.js';
import { Money } from '../../domain/money.js';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../domain/wager-transaction.js';
import { ProcessWagerTransactionUseCase } from './process-wager-transaction.use-case.js';

describe('ProcessWagerTransactionUseCase', () => {
  test('creates a pending wager transaction', () => {
    const useCase = new ProcessWagerTransactionUseCase(() => 'transaction-id');

    const transaction = useCase.execute({
      providerId: 'provider-a',
      externalTransactionId: 'transaction-123',
      idempotencyKey: 'provider-a:transaction-123',
      payloadHash: 'payload-hash',
      walletId: 'wallet-id',
      playerId: 'player-id',
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.Bet,
      money: Money.from({
        amount: '25.00',
        currency: 'BRL',
      }),
    });

    expect(transaction.id).toBe('transaction-id');
    expect(transaction.status).toBe(WagerTransactionStatus.Pending);
    expect(transaction.kind).toBe(WagerTransactionKind.Bet);
  });

  test('rejects externally submitted OPENING transactions', () => {
    const useCase = new ProcessWagerTransactionUseCase(() => 'transaction-id');

    expect(() =>
      useCase.execute({
        providerId: 'provider-a',
        externalTransactionId: 'transaction-123',
        idempotencyKey: 'provider-a:transaction-123',
        payloadHash: 'payload-hash',
        walletId: 'wallet-id',
        playerId: 'player-id',
        roundId: 'round-1',
        gameId: 'game-1',
        kind: WagerTransactionKind.Opening,
        money: Money.from({
          amount: '25.00',
          currency: 'BRL',
        }),
      }),
    ).toThrow(ExternalOpeningTransactionError);
  });
});
