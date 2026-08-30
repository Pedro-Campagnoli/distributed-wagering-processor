import { randomUUID } from 'node:crypto';

import { Money } from '../../domain/money.js';
import {
  WagerTransaction,
  WagerTransactionKind,
} from '../../domain/wager-transaction.js';
import {
  ExternalOpeningTransactionError,
  InsufficientBalanceError,
  WalletNotFoundError,
  WalletPlayerMismatchError,
} from '@/wagering/domain/errors.js';
import type { WalletRepository } from '../ports/wallet.repository.js';
import { Wallet } from '@/wagering/domain/wallet.js';
import { WalletLedgerEntry } from '@/wagering/domain/wallet-ledger-entry.js';

export interface ProcessWagerTransactionInput {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
}

export interface ProcessWagerTransactionOutput {
  transaction: WagerTransaction;
  wallet: Wallet;
  ledgerEntry?: WalletLedgerEntry;
}

type IdGenerator = () => string;

export class ProcessWagerTransactionUseCase {
  constructor(
    private readonly walletRepository: WalletRepository,
    private readonly idGenerator: IdGenerator = randomUUID,
  ) {}

  async execute(
    input: ProcessWagerTransactionInput,
  ): Promise<ProcessWagerTransactionOutput> {
    if (input.kind === WagerTransactionKind.Opening) {
      throw new ExternalOpeningTransactionError();
    }

    const transaction = WagerTransaction.create({
      id: this.idGenerator(),
      providerId: input.providerId,
      externalTransactionId: input.externalTransactionId,
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
      walletId: input.walletId,
      playerId: input.playerId,
      roundId: input.roundId,
      gameId: input.gameId,
      kind: input.kind,
      money: input.money,
      referenceExternalTransactionId: input.referenceExternalTransactionId,
    });

    const wallet = await this.walletRepository.findById(input.walletId);

    if (!wallet) {
      throw new WalletNotFoundError(input.walletId);
    }

    if (wallet.playerId !== input.playerId) {
      throw new WalletPlayerMismatchError();
    }

    switch (transaction.kind) {
      case WagerTransactionKind.Bet:
        return this.processBet(wallet, transaction);

      case WagerTransactionKind.Win:
        return this.processWin(wallet, transaction);

      case WagerTransactionKind.Loss:
        return this.processLoss(wallet, transaction);

      default:
        return {
          transaction,
          wallet,
        };
    }
  }

  private processLoss(
    wallet: Wallet,
    transaction: WagerTransaction,
  ): ProcessWagerTransactionOutput {
    transaction.markProcessed(undefined, new Date());

    return {
      transaction,
      wallet,
    };
  }

  private processWin(
    wallet: Wallet,
    transaction: WagerTransaction,
  ): ProcessWagerTransactionOutput {
    const balanceChange = wallet.credit(transaction.money);

    if (!balanceChange) {
      transaction.reject('INVALID_AMOUNT');

      return {
        transaction,
        wallet,
      };
    }

    transaction.markProcessed(undefined, new Date());

    const ledgerEntry = WalletLedgerEntry.create({
      id: this.idGenerator(),
      walletId: wallet.id,
      transactionId: transaction.id,
      direction: transaction.ledgerDirectionFor(),
      money: transaction.money,
      balanceBefore: balanceChange.balanceBefore,
      balanceAfter: balanceChange.balanceAfter,
    });

    return {
      transaction,
      wallet,
      ledgerEntry,
    };
  }

  private processBet(
    wallet: Wallet,
    transaction: WagerTransaction,
  ): ProcessWagerTransactionOutput {
    try {
      const balanceChange = wallet.debit(transaction.money);

      if (!balanceChange) {
        transaction.reject('INVALID_AMOUNT');

        return {
          transaction,
          wallet,
        };
      }

      transaction.markProcessed(undefined, new Date());

      const ledgerEntry = WalletLedgerEntry.create({
        id: this.idGenerator(),
        walletId: wallet.id,
        transactionId: transaction.id,
        direction: transaction.ledgerDirectionFor(),
        money: transaction.money,
        balanceBefore: balanceChange.balanceBefore,
        balanceAfter: balanceChange.balanceAfter,
      });

      return {
        transaction,
        wallet,
        ledgerEntry,
      };
    } catch (error) {
      if (error instanceof InsufficientBalanceError) {
        transaction.reject('INSUFFICIENT_BALANCE');

        return {
          transaction,
          wallet,
        };
      }

      throw error;
    }
  }
}
