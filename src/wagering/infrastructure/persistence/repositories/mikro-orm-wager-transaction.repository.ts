import type { EntityManager } from '@mikro-orm/postgresql';

import type { WagerTransactionRepository } from '../../../application/ports/wager-transaction.repository.js';
import type { WagerTransaction } from '../../../domain/wager-transaction.js';
import { WagerTransactionMapper } from '../mappers/wager-transaction.mapper.js';
import { WagerTransactionOrmEntity } from '../entities/wager-transaction.orm-entity.js';

export class MikroOrmWagerTransactionRepository implements WagerTransactionRepository {
  constructor(private readonly entityManager: EntityManager) {}

  async insert(transaction: WagerTransaction): Promise<void> {
    const entity = WagerTransactionMapper.toOrm(transaction);

    this.entityManager.persist(entity);

    await this.entityManager.flush();
  }

  async findById(id: string): Promise<WagerTransaction | undefined> {
    const entity = await this.entityManager.findOne(
      WagerTransactionOrmEntity,
      id,
    );

    if (!entity) {
      return;
    }

    return WagerTransactionMapper.toDomain(entity);
  }

  async findByProviderAndExternalTransactionId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | undefined> {
    const entity = await this.entityManager.findOne(WagerTransactionOrmEntity, {
      providerId,
      externalTransactionId,
    });

    if (!entity) {
      return;
    }

    return WagerTransactionMapper.toDomain(entity);
  }

  async findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<WagerTransaction | undefined> {
    const entity = await this.entityManager.findOne(WagerTransactionOrmEntity, {
      idempotencyKey,
    });

    if (!entity) {
      return;
    }

    return WagerTransactionMapper.toDomain(entity);
  }
}
