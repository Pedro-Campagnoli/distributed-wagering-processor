import { Logger } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/postgresql';

import {
  InvalidLedgerCursorError,
  WagerTransactionNotFoundError,
  WalletNotFoundError,
} from '../../domain/errors.js';
import { Money } from '../../domain/money.js';
import type { WagerTransaction } from '../../domain/wager-transaction.js';
import {
  LedgerDirection,
  type WalletLedgerEntry,
} from '../../domain/wallet-ledger-entry.js';
import type { Wallet } from '../../domain/wallet.js';
import { MikroOrmWagerTransactionRepository } from '../../infrastructure/persistence/repositories/mikro-orm-wager-transaction.repository.js';
import { MikroOrmWalletLedgerEntryRepository } from '../../infrastructure/persistence/repositories/mikro-orm-wallet-ledger-entry.repository.js';
import { MikroOrmWalletRepository } from '../../infrastructure/persistence/repositories/mikro-orm-wallet.repository.js';
import {
  OperationalMetrics,
  operationalMetrics,
} from '../../infrastructure/observability/operational-metrics.js';

interface LedgerCursorPayload {
  createdAt: string;
  id: string;
}

export interface WalletLedgerPage {
  entries: WalletLedgerEntry[];
  nextCursor?: string;
}

export interface WalletReconciliation {
  walletId: string;
  storedBalance: Money;
  calculatedBalance: Money;
  difference: Money;
  consistent: boolean;
  checkedEntries: number;
}

export class WageringQueryService {
  private readonly logger = new Logger(WageringQueryService.name);

  constructor(
    private readonly entityManager: EntityManager,
    private readonly metrics: OperationalMetrics = operationalMetrics,
  ) {}

  async getWallet(walletId: string): Promise<Wallet> {
    const wallet = await new MikroOrmWalletRepository(
      this.entityManager.fork(),
    ).findById(walletId);

    if (!wallet) {
      throw new WalletNotFoundError(walletId);
    }

    return wallet;
  }

  async getWalletLedger(
    walletId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<WalletLedgerPage> {
    await this.getWallet(walletId);
    const repository = new MikroOrmWalletLedgerEntryRepository(
      this.entityManager.fork(),
    );
    const decodedCursor = cursor ? this.decodeCursor(cursor) : undefined;
    const entries = await repository.findPageByWalletId(
      walletId,
      decodedCursor,
      limit + 1,
    );
    const hasNextPage = entries.length > limit;
    const pageEntries = entries.slice(0, limit);
    const lastEntry = pageEntries.at(-1);

    return {
      entries: pageEntries,
      ...(hasNextPage && lastEntry
        ? { nextCursor: this.encodeCursor(lastEntry) }
        : {}),
    };
  }

  async getTransactionById(transactionId: string): Promise<WagerTransaction> {
    const transaction = await new MikroOrmWagerTransactionRepository(
      this.entityManager.fork(),
    ).findById(transactionId);

    if (!transaction) {
      throw new WagerTransactionNotFoundError();
    }

    return transaction;
  }

  async getTransactionByProvider(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction> {
    const transaction = await new MikroOrmWagerTransactionRepository(
      this.entityManager.fork(),
    ).findByProviderAndExternalTransactionId(providerId, externalTransactionId);

    if (!transaction) {
      throw new WagerTransactionNotFoundError();
    }

    return transaction;
  }

  async reconcileWallet(walletId: string): Promise<WalletReconciliation> {
    return this.entityManager.fork().transactional(async (tx) => {
      const wallet = await new MikroOrmWalletRepository(tx).findById(walletId, {
        lock: true,
      });

      if (!wallet) {
        throw new WalletNotFoundError(walletId);
      }

      const entries = await new MikroOrmWalletLedgerEntryRepository(
        tx,
      ).findAllByWalletId(walletId);
      let calculatedBalance = Money.zero(wallet.currency);

      for (const entry of entries) {
        calculatedBalance =
          entry.direction === LedgerDirection.Credit
            ? calculatedBalance.add(entry.money)
            : calculatedBalance.subtract(entry.money);
      }

      const difference = wallet.balance.subtract(calculatedBalance);
      const consistent = difference.isZero();

      if (!consistent) {
        this.metrics.recordReconciliationMismatch();
        this.logger.warn(
          JSON.stringify({
            event: 'wallet_reconciliation_mismatch',
            walletId,
            checkedEntries: entries.length,
          }),
        );
      }

      return {
        walletId,
        storedBalance: wallet.balance,
        calculatedBalance,
        difference,
        consistent,
        checkedEntries: entries.length,
      };
    });
  }

  private encodeCursor(entry: WalletLedgerEntry): string {
    return Buffer.from(
      JSON.stringify({
        createdAt: entry.createdAt.toISOString(),
        id: entry.id,
      } satisfies LedgerCursorPayload),
    ).toString('base64url');
  }

  private decodeCursor(cursor: string): { createdAt: Date; id: string } {
    try {
      const payload = JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf8'),
      ) as Partial<LedgerCursorPayload>;
      const createdAt = new Date(payload.createdAt ?? '');

      if (!payload.id || Number.isNaN(createdAt.getTime())) {
        throw new InvalidLedgerCursorError();
      }

      return { createdAt, id: payload.id };
    } catch (error) {
      if (error instanceof InvalidLedgerCursorError) {
        throw error;
      }

      throw new InvalidLedgerCursorError();
    }
  }
}
