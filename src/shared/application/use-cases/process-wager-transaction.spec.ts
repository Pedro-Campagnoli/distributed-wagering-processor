import { describe, expect, test } from 'bun:test';

import {
  ExternalOpeningTransactionError,
  WalletNotFoundError,
  WalletPlayerMismatchError,
} from '../../domain/errors.js';

import { Money } from '../../domain/money.js';

import { Wallet } from '../../domain/wallet.js';

import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../domain/wager-transaction.js';

import type { WalletRepository } from '../repositories/wallet.repository.js';

import { ProcessWagerTransactionUseCase } from './process-wager-transaction.use-case.js';
import { LedgerDirection } from '@/shared/domain/wallet-ledger-entry.js';

const createWallet = (balance: string = '100.00') =>
  Wallet.open({
    id: 'wallet-id',
    playerId: 'player-id',
    initialBalance: Money.from({
      amount: balance,
      currency: 'BRL',
    }),
  });

const createWalletRepository = (wallet: Wallet | undefined): WalletRepository =>
  ({
    findById: async () => wallet,
    findByPlayerAndCurrency: async () => undefined,
    insert: async () => undefined,
  }) as WalletRepository;

const createInput = (kind: WagerTransactionKind, amount: string = '25.00') => ({
  providerId: 'provider-a',
  externalTransactionId: 'transaction-123',
  idempotencyKey: 'provider-a:transaction-123',
  payloadHash: 'payload-hash',
  walletId: 'wallet-id',
  playerId: 'player-id',
  roundId: 'round-1',
  gameId: 'game-1',
  kind,
  money: Money.from({
    amount,
    currency: 'BRL',
  }),
});

describe('ProcessWagerTransactionUseCase', () => {
  test('rejects externally submitted OPENING transactions', async () => {
    const wallet = createWallet();

    const useCase = new ProcessWagerTransactionUseCase(
      createWalletRepository(wallet),
      () => 'transaction-id',
    );

    await expect(
      useCase.execute(createInput(WagerTransactionKind.Opening)),
    ).rejects.toBeInstanceOf(ExternalOpeningTransactionError);
  });

  describe('Bet', async () => {
    test('processes BET with sufficient balance', async () => {
      const wallet = createWallet('100.00');

      const useCase = new ProcessWagerTransactionUseCase(
        createWalletRepository(wallet),
        () => 'transaction-id',
      );

      const result = await useCase.execute(
        createInput(WagerTransactionKind.Bet, '25.00'),
      );

      expect(result.transaction.status).toBe(WagerTransactionStatus.Processed);

      expect(result.wallet.balance.toJSON().amount).toBe('75.00');

      expect(result.ledgerEntry).toBeDefined();
    });

    test('creates DEBIT ledger entry for processed BET', async () => {
      const wallet = createWallet('100.00');

      const useCase = new ProcessWagerTransactionUseCase(
        createWalletRepository(wallet),
        () => 'transaction-id',
      );

      const result = await useCase.execute(
        createInput(WagerTransactionKind.Bet, '25.00'),
      );

      expect(result.ledgerEntry?.direction).toBe(LedgerDirection.Debit);

      expect(result.ledgerEntry?.balanceBefore.toJSON().amount).toBe('100.00');

      expect(result.ledgerEntry?.money.toJSON().amount).toBe('25.00');

      expect(result.ledgerEntry?.balanceAfter.toJSON().amount).toBe('75.00');
    });

    test('rejects BET with insufficient balance', async () => {
      const wallet = createWallet('100.00');

      const useCase = new ProcessWagerTransactionUseCase(
        createWalletRepository(wallet),
        () => 'transaction-id',
      );

      const result = await useCase.execute(
        createInput(WagerTransactionKind.Bet, '150.00'),
      );

      expect(result.transaction.status).toBe(WagerTransactionStatus.Rejected);

      expect(result.wallet.balance.toJSON().amount).toBe('100.00');

      expect(result.ledgerEntry).toBeUndefined();
    });
  });

  describe('Win', async () => {
    test('processes WIN and credits the wallet', async () => {
      const wallet = createWallet('100.00');

      const useCase = new ProcessWagerTransactionUseCase(
        createWalletRepository(wallet),
        () => 'transaction-id',
      );

      const result = await useCase.execute(
        createInput(WagerTransactionKind.Win, '25.00'),
      );

      expect(result.transaction.status).toBe(WagerTransactionStatus.Processed);

      expect(result.wallet.balance.toJSON().amount).toBe('125.00');

      expect(result.ledgerEntry).toBeDefined();

      expect(result.ledgerEntry?.direction).toBe(LedgerDirection.Credit);

      expect(result.ledgerEntry?.balanceBefore.toJSON().amount).toBe('100.00');

      expect(result.ledgerEntry?.money.toJSON().amount).toBe('25.00');

      expect(result.ledgerEntry?.balanceAfter.toJSON().amount).toBe('125.00');
    });

    test('processes WIN with zero wallet balance', async () => {
      const wallet = createWallet('0.00');

      const useCase = new ProcessWagerTransactionUseCase(
        createWalletRepository(wallet),
        () => 'transaction-id',
      );

      const result = await useCase.execute(
        createInput(WagerTransactionKind.Win, '25.00'),
      );

      expect(result.transaction.status).toBe(WagerTransactionStatus.Processed);

      expect(result.wallet.balance.toJSON().amount).toBe('25.00');

      expect(result.ledgerEntry?.direction).toBe(LedgerDirection.Credit);
    });
  });

  describe('LOSS', () => {
    test('processes LOSS without changing wallet balance or creating ledger entry', async () => {
      const wallet = createWallet('100.00');

      const useCase = new ProcessWagerTransactionUseCase(
        createWalletRepository(wallet),
        () => 'transaction-id',
      );

      const result = await useCase.execute(
        createInput(WagerTransactionKind.Loss, '25.00'),
      );

      expect(result.transaction.kind).toBe(WagerTransactionKind.Loss);

      expect(result.transaction.status).toBe(WagerTransactionStatus.Processed);

      expect(result.wallet.balance.toJSON().amount).toBe('100.00');

      expect(result.ledgerEntry).toBeUndefined();
    });
  });
  describe('Wallet validation', () => {
    test('throws when wallet does not exist', async () => {
      const useCase = new ProcessWagerTransactionUseCase(
        createWalletRepository(undefined),
        () => 'transaction-id',
      );

      await expect(
        useCase.execute(createInput(WagerTransactionKind.Bet)),
      ).rejects.toBeInstanceOf(WalletNotFoundError);
    });

    test('throws when wallet belongs to another player', async () => {
      const wallet = createWallet();

      const useCase = new ProcessWagerTransactionUseCase(
        createWalletRepository(wallet),
        () => 'transaction-id',
      );

      await expect(
        useCase.execute({
          ...createInput(WagerTransactionKind.Bet),
          playerId: 'another-player-id',
        }),
      ).rejects.toBeInstanceOf(WalletPlayerMismatchError);
    });
  });
});
