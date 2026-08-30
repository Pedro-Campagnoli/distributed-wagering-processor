import { describe, expect, test } from 'bun:test';

import { ExternalOpeningTransactionError } from '../../domain/errors.js';
import { Money } from '../../domain/money.js';
import { Wallet } from '../../domain/wallet.js';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../domain/wager-transaction.js';
import type { WalletRepository } from '../repositories/wallet.repository.js';
import { ProcessWagerTransactionUseCase } from './process-wager-transaction.use-case.js';

describe('ProcessWagerTransactionUseCase', () => {
  const wallet = {
    id: 'wallet-id',
    playerId: 'player-id',
  } as Wallet;

  const walletRepository = {
    findById: async () => wallet,
    findByPlayerAndCurrency: async () => undefined,
    insert: async () => undefined,
  } as WalletRepository;

  test('creates a pending wager transaction', async () => {
    const useCase = new ProcessWagerTransactionUseCase(
      walletRepository,
      () => 'transaction-id',
    );

    const result = await useCase.execute({
      providerId: 'provider-a',
      externalTransactionId: 'transaction-123',
      idempotencyKey: 'provider-a:transaction-123',
      payloadHash: 'payload-hash',
      walletId: 'wallet-id',
      playerId: 'player-id',
      roundId: 'round-1',
      gameId: 'game-1',

      // Usamos WIN aqui porque BET agora já possui processamento próprio.
      kind: WagerTransactionKind.Win,

      money: Money.from({
        amount: '25.00',
        currency: 'BRL',
      }),
    });

    expect(result.transaction.id).toBe('transaction-id');
    expect(result.transaction.status).toBe(WagerTransactionStatus.Pending);
    expect(result.transaction.kind).toBe(WagerTransactionKind.Win);
  });

  test('rejects externally submitted OPENING transactions', async () => {
    const useCase = new ProcessWagerTransactionUseCase(
      walletRepository,
      () => 'transaction-id',
    );

    await expect(
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
    ).rejects.toBeInstanceOf(ExternalOpeningTransactionError);
  });
});
