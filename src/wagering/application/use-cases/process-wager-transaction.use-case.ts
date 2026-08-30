import { randomUUID } from 'node:crypto';

import type { EntityManager } from '@mikro-orm/postgresql';

import { Money } from '../../domain/money.js';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../domain/wager-transaction.js';
import {
  ExternalOpeningTransactionError,
  IdempotencyConflictError,
  InsufficientBalanceError,
  WalletNotFoundError,
  WalletPlayerMismatchError,
} from '@/wagering/domain/errors.js';
import { Wallet } from '@/wagering/domain/wallet.js';
import { WalletLedgerEntry } from '../../domain/wallet-ledger-entry.js';
import { MikroOrmWagerTransactionRepository } from '../../infrastructure/persistence/repositories/mikro-orm-wager-transaction.repository.js';
import { MikroOrmWalletLedgerEntryRepository } from '../../infrastructure/persistence/repositories/mikro-orm-wallet-ledger-entry.repository.js';
import { MikroOrmWalletRepository } from '../../infrastructure/persistence/repositories/mikro-orm-wallet.repository.js';
import { enqueueWagerIntegrationEvents } from '../services/enqueue-wager-integration-events.js';
import { calculateWagerPayloadHash } from '../services/wager-payload-hash.js';

export interface ProcessWagerTransactionInput {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
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
  observedBalance?: Money;
  wallet?: Wallet;
  ledgerEntry?: WalletLedgerEntry;
}

interface ProcessedWagerTransaction {
  transaction: WagerTransaction;
  wallet: Wallet;
  ledgerEntry?: WalletLedgerEntry;
}

type IdGenerator = () => string;

export const MAX_REFERENCE_RETRY_ATTEMPTS = 5;
export const REFERENCE_RETRY_BASE_DELAY_MS = 1_000;

function referenceRetryDelayMs(attempts: number): number {
  return REFERENCE_RETRY_BASE_DELAY_MS * 2 ** attempts;
}

export class ProcessWagerTransactionUseCase {
  constructor(
    private readonly entityManager: EntityManager,
    private readonly idGenerator: IdGenerator = randomUUID,
  ) {}

  async execute(
    input: ProcessWagerTransactionInput,
  ): Promise<ProcessWagerTransactionOutput> {
    if (input.kind === WagerTransactionKind.Opening) {
      throw new ExternalOpeningTransactionError();
    }

    const payloadHash = calculateWagerPayloadHash(input);

    return this.entityManager.transactional(async (tx) => {
      const walletRepository = new MikroOrmWalletRepository(tx);
      const wagerTransactionRepository = new MikroOrmWagerTransactionRepository(
        tx,
      );
      const walletLedgerEntryRepository =
        new MikroOrmWalletLedgerEntryRepository(tx);

      const existingTransaction =
        await wagerTransactionRepository.findByIdempotencyKey(
          input.idempotencyKey,
        );

      if (existingTransaction) {
        if (!existingTransaction.matchesPayload(payloadHash)) {
          throw new IdempotencyConflictError(input.idempotencyKey);
        }

        return {
          transaction: existingTransaction,
          observedBalance: existingTransaction.observedBalance,
        };
      }

      const wallet = await walletRepository.findById(input.walletId, {
        lock: true,
      });

      if (!wallet) {
        throw new WalletNotFoundError(input.walletId);
      }

      if (wallet.playerId !== input.playerId) {
        throw new WalletPlayerMismatchError();
      }

      const concurrentTransaction =
        await wagerTransactionRepository.findByIdempotencyKey(
          input.idempotencyKey,
        );

      if (concurrentTransaction) {
        if (!concurrentTransaction.matchesPayload(payloadHash)) {
          throw new IdempotencyConflictError(input.idempotencyKey);
        }

        return {
          transaction: concurrentTransaction,
          observedBalance: concurrentTransaction.observedBalance,
        };
      }

      const transaction = WagerTransaction.create({
        id: this.idGenerator(),
        providerId: input.providerId,
        externalTransactionId: input.externalTransactionId,
        idempotencyKey: input.idempotencyKey,
        payloadHash,
        walletId: input.walletId,
        playerId: input.playerId,
        roundId: input.roundId,
        gameId: input.gameId,
        kind: input.kind,
        money: input.money,
        referenceExternalTransactionId: input.referenceExternalTransactionId,
      });

      if (wallet.currency !== transaction.money.currency) {
        transaction.reject('CURRENCY_MISMATCH');
      }

      let reference: WagerTransaction | undefined;

      if (!transaction.isTerminal() && transaction.requiresReference()) {
        reference =
          await wagerTransactionRepository.findByProviderAndExternalTransactionId(
            transaction.providerId,
            transaction.referenceExternalTransactionId!,
          );

        const previousReversal =
          await wagerTransactionRepository.findByProviderKindAndReferenceExternalTransactionId(
            transaction.providerId,
            transaction.kind,
            transaction.referenceExternalTransactionId!,
          );

        if (previousReversal) {
          transaction.reject(
            this.duplicateReversalFailureCode(transaction.kind),
          );
        }

        if (!reference && !transaction.isTerminal()) {
          transaction.markPendingReference(
            new Date(
              transaction.createdAt.getTime() + REFERENCE_RETRY_BASE_DELAY_MS,
            ),
          );
        }
      }

      const result = this.processTransaction(wallet, transaction, reference);
      const observedBalance = result.wallet.balance;

      result.transaction.recordObservedBalance(observedBalance);

      await wagerTransactionRepository.insert(result.transaction);

      if (result.ledgerEntry) {
        await walletRepository.update(result.wallet);
        await walletLedgerEntryRepository.insert(result.ledgerEntry);
      }

      await enqueueWagerIntegrationEvents(tx, result);

      return {
        ...result,
        observedBalance,
      };
    });
  }

  async reprocessPending(
    transactionId: string,
    walletId: string,
    now: Date = new Date(),
  ): Promise<ProcessWagerTransactionOutput | undefined> {
    return this.entityManager.transactional(async (tx) => {
      const walletRepository = new MikroOrmWalletRepository(tx);
      const wagerTransactionRepository = new MikroOrmWagerTransactionRepository(
        tx,
      );
      const walletLedgerEntryRepository =
        new MikroOrmWalletLedgerEntryRepository(tx);

      const wallet = await walletRepository.findById(walletId, {
        lock: true,
      });

      if (!wallet) {
        throw new WalletNotFoundError(walletId);
      }

      const transaction =
        await wagerTransactionRepository.findById(transactionId);

      if (
        !transaction ||
        transaction.status !== WagerTransactionStatus.PendingReference
      ) {
        return;
      }

      if (
        transaction.nextReferenceRetryAt &&
        transaction.nextReferenceRetryAt > now
      ) {
        return;
      }

      const reference =
        await wagerTransactionRepository.findByProviderAndExternalTransactionId(
          transaction.providerId,
          transaction.referenceExternalTransactionId!,
        );

      if (!reference) {
        const attempt = transaction.referenceRetryAttempts + 1;

        transaction.recordReferenceRetry(
          new Date(now.getTime() + referenceRetryDelayMs(attempt)),
        );

        if (attempt >= MAX_REFERENCE_RETRY_ATTEMPTS) {
          transaction.reject('REFERENCE_NOT_FOUND_AFTER_RETRIES');
        }

        transaction.recordObservedBalance(wallet.balance);

        await wagerTransactionRepository.update(transaction);

        if (attempt >= MAX_REFERENCE_RETRY_ATTEMPTS) {
          await enqueueWagerIntegrationEvents(tx, {
            transaction,
            wallet,
          });
        }

        return {
          transaction,
          wallet,
          observedBalance: wallet.balance,
        };
      }

      const previousReversal =
        await wagerTransactionRepository.findByProviderKindAndReferenceExternalTransactionId(
          transaction.providerId,
          transaction.kind,
          transaction.referenceExternalTransactionId!,
        );

      if (previousReversal) {
        transaction.reject(this.duplicateReversalFailureCode(transaction.kind));
        transaction.recordObservedBalance(wallet.balance);

        await wagerTransactionRepository.update(transaction);

        await enqueueWagerIntegrationEvents(tx, {
          transaction,
          wallet,
        });

        return {
          transaction,
          wallet,
          observedBalance: wallet.balance,
        };
      }

      const result = this.processTransaction(wallet, transaction, reference);
      const observedBalance = result.wallet.balance;

      result.transaction.recordObservedBalance(observedBalance);

      await wagerTransactionRepository.update(result.transaction);

      if (result.ledgerEntry) {
        await walletRepository.update(result.wallet);
        await walletLedgerEntryRepository.insert(result.ledgerEntry);
      }

      await enqueueWagerIntegrationEvents(tx, result);

      return {
        ...result,
        observedBalance,
      };
    });
  }

  private processTransaction(
    wallet: Wallet,
    transaction: WagerTransaction,
    reference?: WagerTransaction,
  ): ProcessedWagerTransaction {
    if (transaction.isTerminal()) {
      return {
        transaction,
        wallet,
      };
    }

    if (
      transaction.status === WagerTransactionStatus.PendingReference &&
      !reference
    ) {
      return {
        transaction,
        wallet,
      };
    }

    switch (transaction.kind) {
      case WagerTransactionKind.Bet:
        return this.processBet(wallet, transaction);

      case WagerTransactionKind.Win:
        return this.processWin(wallet, transaction);

      case WagerTransactionKind.Loss:
        return this.processLoss(wallet, transaction);

      case WagerTransactionKind.Refund:
        return this.processRefund(wallet, transaction, reference!);

      case WagerTransactionKind.Rollback:
        return this.processRollback(wallet, transaction, reference!);

      default:
        return {
          transaction,
          wallet,
        };
    }
  }

  private duplicateReversalFailureCode(kind: WagerTransactionKind): string {
    return kind === WagerTransactionKind.Refund
      ? 'REFERENCE_ALREADY_REFUNDED'
      : 'REFERENCE_ALREADY_ROLLED_BACK';
  }

  private processRefund(
    wallet: Wallet,
    transaction: WagerTransaction,
    reference: WagerTransaction,
  ): ProcessedWagerTransaction {
    const failureCode = this.reversalFailureCode(transaction, reference);

    if (failureCode) {
      transaction.reject(failureCode);

      return {
        transaction,
        wallet,
      };
    }

    const balanceChange = wallet.credit(transaction.money);

    if (!balanceChange) {
      transaction.reject('INVALID_AMOUNT');

      return {
        transaction,
        wallet,
      };
    }

    transaction.markProcessed(reference.id, new Date());

    const ledgerEntry = WalletLedgerEntry.create({
      id: this.idGenerator(),
      walletId: wallet.id,
      transactionId: transaction.id,
      direction: transaction.ledgerDirectionFor(reference),
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

  private processRollback(
    wallet: Wallet,
    transaction: WagerTransaction,
    reference: WagerTransaction,
  ): ProcessedWagerTransaction {
    const failureCode = this.reversalFailureCode(transaction, reference);

    if (failureCode) {
      transaction.reject(failureCode);

      return {
        transaction,
        wallet,
      };
    }

    try {
      const balanceChange =
        reference.kind === WagerTransactionKind.Bet
          ? wallet.credit(transaction.money)
          : wallet.debit(transaction.money);

      if (!balanceChange) {
        transaction.reject('INVALID_AMOUNT');

        return {
          transaction,
          wallet,
        };
      }

      transaction.markProcessed(reference.id, new Date());

      const ledgerEntry = WalletLedgerEntry.create({
        id: this.idGenerator(),
        walletId: wallet.id,
        transactionId: transaction.id,
        direction: transaction.ledgerDirectionFor(reference),
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
        transaction.reject('ROLLBACK_INSUFFICIENT_BALANCE');

        return {
          transaction,
          wallet,
        };
      }

      throw error;
    }
  }

  private reversalFailureCode(
    transaction: WagerTransaction,
    reference: WagerTransaction,
  ): string | undefined {
    const isValidRefundReference =
      transaction.kind === WagerTransactionKind.Refund &&
      reference.kind === WagerTransactionKind.Bet;
    const isValidRollbackReference =
      transaction.kind === WagerTransactionKind.Rollback &&
      (reference.kind === WagerTransactionKind.Bet ||
        reference.kind === WagerTransactionKind.Win ||
        reference.kind === WagerTransactionKind.Refund);

    if (!isValidRefundReference && !isValidRollbackReference) {
      return 'INVALID_REFERENCE_KIND';
    }

    if (reference.status !== WagerTransactionStatus.Processed) {
      return 'REFERENCE_NOT_PROCESSED';
    }

    if (
      reference.providerId !== transaction.providerId ||
      reference.playerId !== transaction.playerId ||
      reference.walletId !== transaction.walletId ||
      reference.money.currency !== transaction.money.currency ||
      reference.roundId !== transaction.roundId
    ) {
      return 'REFERENCE_DATA_MISMATCH';
    }

    if (!reference.money.equals(transaction.money)) {
      return 'REFERENCE_AMOUNT_MISMATCH';
    }
  }

  private processLoss(
    wallet: Wallet,
    transaction: WagerTransaction,
  ): ProcessedWagerTransaction {
    transaction.markProcessed(undefined, new Date());

    return {
      transaction,
      wallet,
    };
  }

  private processWin(
    wallet: Wallet,
    transaction: WagerTransaction,
  ): ProcessedWagerTransaction {
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
  ): ProcessedWagerTransaction {
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
