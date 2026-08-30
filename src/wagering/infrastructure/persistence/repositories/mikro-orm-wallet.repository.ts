import { LockMode } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';

import type { WalletRepository } from '../../../application/ports/wallet.repository.js';
import type { Wallet } from '../../../domain/wallet.js';
import { WalletMapper } from '../mappers/wallet.mapper.js';
import { WalletOrmEntity } from '../entities/wallet.orm-entity.js';

export class MikroOrmWalletRepository implements WalletRepository {
  constructor(private readonly entityManager: EntityManager) {}

  async insert(wallet: Wallet): Promise<void> {
    const entity = WalletMapper.toOrm(wallet);

    this.entityManager.persist(entity);

    await this.entityManager.flush();
  }

  async update(wallet: Wallet): Promise<void> {
    const entity = await this.entityManager.findOne(WalletOrmEntity, wallet.id);

    if (!entity) {
      return;
    }

    WalletMapper.updateOrm(wallet, entity);

    await this.entityManager.flush();
  }

  async findById(
    id: string,
    options?: { lock?: boolean },
  ): Promise<Wallet | undefined> {
    const entity = await this.entityManager.findOne(
      WalletOrmEntity,
      id,
      options?.lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : {},
    );

    if (!entity) {
      return;
    }

    return WalletMapper.toDomain(entity);
  }

  async findByPlayerAndCurrency(
    playerId: string,
    currency: string,
  ): Promise<Wallet | undefined> {
    const entity = await this.entityManager.findOne(WalletOrmEntity, {
      playerId,
      currency,
    });

    if (!entity) {
      return;
    }

    return WalletMapper.toDomain(entity);
  }
}
