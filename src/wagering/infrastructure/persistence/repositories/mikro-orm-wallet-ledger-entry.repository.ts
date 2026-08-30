import type { EntityManager } from '@mikro-orm/postgresql';

import type { WalletLedgerEntryRepository } from '../../../application/ports/wallet-ledger-entry.repository.js';
import type { WalletLedgerEntry } from '../../../domain/wallet-ledger-entry.js';
import { WalletLedgerEntryMapper } from '../mappers/wallet-ledger-entry.mapper.js';

export class MikroOrmWalletLedgerEntryRepository implements WalletLedgerEntryRepository {
  constructor(private readonly entityManager: EntityManager) {}

  async insert(entry: WalletLedgerEntry): Promise<void> {
    const entity = WalletLedgerEntryMapper.toOrm(entry);

    this.entityManager.persist(entity);

    await this.entityManager.flush();
  }
}
