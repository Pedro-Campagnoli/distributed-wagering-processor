import { createHash, randomUUID } from 'node:crypto';

import type { EntityManager } from '@mikro-orm/postgresql';

import { Money } from '../../domain/money.js';
import { WalletLedgerEntry } from '../../domain/wallet-ledger-entry.js';
import {
  WagerTransaction,
  WagerTransactionKind,
} from '../../domain/wager-transaction.js';
import { Wallet } from '../../domain/wallet.js';
import { MikroOrmWagerTransactionRepository } from '../../infrastructure/persistence/mikro-orm-wager-transaction.repository.js';
import { MikroOrmWalletLedgerEntryRepository } from '../../infrastructure/persistence/mikro-orm-wallet-ledger-entry.repository.js';
import { MikroOrmWalletRepository } from '../../infrastructure/persistence/mikro-orm-wallet.repository.js';

export interface OpenWalletInput {
  playerId: string;
  initialBalance: Money;
}

export class OpenWalletUseCase {
  constructor(
    private readonly entityManager: EntityManager,
    private readonly generateId: () => string = randomUUID,
  ) {}

  execute(input: OpenWalletInput): Promise<Wallet> {
    return this.entityManager.transactional(
      async (transactionalEntityManager) => {
        const walletRepository = new MikroOrmWalletRepository(
          transactionalEntityManager,
        );
        const wagerTransactionRepository =
          new MikroOrmWagerTransactionRepository(transactionalEntityManager);
        const walletLedgerEntryRepository =
          new MikroOrmWalletLedgerEntryRepository(transactionalEntityManager);

        const wallet = Wallet.open({
          id: this.generateId(),
          playerId: input.playerId,
          initialBalance: input.initialBalance,
        });

        await walletRepository.insert(wallet);

        if (input.initialBalance.isZero()) {
          return wallet;
        }

        const openingIdentity = `opening:${wallet.id}`;
        const opening = WagerTransaction.create({
          id: this.generateId(),
          providerId: 'SYSTEM',
          externalTransactionId: openingIdentity,
          idempotencyKey: `SYSTEM:${openingIdentity}`,
          payloadHash: this.hashOpeningPayload(wallet),
          walletId: wallet.id,
          playerId: wallet.playerId,
          roundId: openingIdentity,
          gameId: 'SYSTEM',
          kind: WagerTransactionKind.Opening,
          money: input.initialBalance,
        });

        opening.markProcessed(undefined, new Date());
        await wagerTransactionRepository.insert(opening);

        const ledgerEntry = WalletLedgerEntry.create({
          id: this.generateId(),
          walletId: wallet.id,
          transactionId: opening.id,
          direction: opening.ledgerDirectionFor(),
          money: input.initialBalance,
          balanceBefore: Money.zero(wallet.currency),
          balanceAfter: wallet.balance,
        });

        await walletLedgerEntryRepository.insert(ledgerEntry);

        return wallet;
      },
    );
  }

  private hashOpeningPayload(wallet: Wallet): string {
    const balance = wallet.balance.toJSON();
    const payload = [
      WagerTransactionKind.Opening,
      wallet.id,
      wallet.playerId,
      balance.amount,
      balance.currency,
    ].join('\n');

    return createHash('sha256').update(payload).digest('hex');
  }
}
