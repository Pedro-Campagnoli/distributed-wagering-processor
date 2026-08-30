import type { EntityManager } from '@mikro-orm/postgresql';

import type { WalletLedgerEntryRepository } from '../../../application/ports/wallet-ledger-entry.repository.js';
import type { WalletLedgerEntry } from '../../../domain/wallet-ledger-entry.js';

export class MikroOrmWalletLedgerEntryRepository implements WalletLedgerEntryRepository {
  constructor(private readonly entityManager: EntityManager) {}

  async insert(entry: WalletLedgerEntry): Promise<void> {
    const money = entry.money.toJSON();
    const balanceBefore = entry.balanceBefore.toJSON();
    const balanceAfter = entry.balanceAfter.toJSON();

    await this.entityManager.execute(
      `
        insert into wallet_ledger_entries (
          id,
          wallet_id,
          transaction_id,
          direction,
          amount,
          currency,
          balance_before,
          balance_after,
          created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        entry.id,
        entry.walletId,
        entry.transactionId,
        entry.direction,
        money.amount,
        money.currency,
        balanceBefore.amount,
        balanceAfter.amount,
        entry.createdAt,
      ],
      'run',
    );
  }
}
