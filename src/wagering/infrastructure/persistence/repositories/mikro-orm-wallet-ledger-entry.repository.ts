import type { EntityManager } from '@mikro-orm/postgresql';

import type {
  WalletLedgerCursor,
  WalletLedgerEntryRepository,
} from '../../../application/ports/wallet-ledger-entry.repository.js';
import type { WalletLedgerEntry } from '../../../domain/wallet-ledger-entry.js';
import { WalletLedgerEntryOrmEntity } from '../entities/wallet-ledger-entry.orm-entity.js';
import { WalletLedgerEntryMapper } from '../mappers/wallet-ledger-entry.mapper.js';

export class MikroOrmWalletLedgerEntryRepository implements WalletLedgerEntryRepository {
  constructor(private readonly entityManager: EntityManager) {}

  async insert(entry: WalletLedgerEntry): Promise<void> {
    const entity = WalletLedgerEntryMapper.toOrm(entry);

    this.entityManager.persist(entity);

    await this.entityManager.flush();
  }

  async findPageByWalletId(
    walletId: string,
    cursor: WalletLedgerCursor | undefined,
    limit: number,
  ): Promise<WalletLedgerEntry[]> {
    const entities = await this.entityManager.find(
      WalletLedgerEntryOrmEntity,
      {
        walletId,
        ...(cursor
          ? {
              $or: [
                { createdAt: { $lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { $lt: cursor.id } },
              ],
            }
          : {}),
      },
      {
        orderBy: { createdAt: 'desc', id: 'desc' },
        limit,
      },
    );

    return entities.map(WalletLedgerEntryMapper.toDomain);
  }

  async findAllByWalletId(walletId: string): Promise<WalletLedgerEntry[]> {
    const entities = await this.entityManager.find(
      WalletLedgerEntryOrmEntity,
      { walletId },
      { orderBy: { createdAt: 'asc', id: 'asc' } },
    );

    return entities.map(WalletLedgerEntryMapper.toDomain);
  }
}
