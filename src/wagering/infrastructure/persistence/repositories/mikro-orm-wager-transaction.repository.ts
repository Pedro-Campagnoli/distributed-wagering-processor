import type { EntityManager } from '@mikro-orm/postgresql';

import type { WagerTransactionRepository } from '../../../application/ports/wager-transaction.repository.js';
import type {
  WagerTransaction,
  WagerTransactionKind,
} from '../../../domain/wager-transaction.js';
import { WagerTransactionStatus } from '../../../domain/wager-transaction.js';
import { WagerTransactionMapper } from '../mappers/wager-transaction.mapper.js';
import { WagerTransactionOrmEntity } from '../entities/wager-transaction.orm-entity.js';

export class MikroOrmWagerTransactionRepository implements WagerTransactionRepository {
  constructor(private readonly entityManager: EntityManager) {}

  async insert(transaction: WagerTransaction): Promise<void> {
    const entity = WagerTransactionMapper.toOrm(transaction);

    this.entityManager.persist(entity);

    await this.entityManager.flush();
  }

  async update(transaction: WagerTransaction): Promise<void> {
    const entity = await this.entityManager.findOne(
      WagerTransactionOrmEntity,
      transaction.id,
    );

    if (!entity) {
      return;
    }

    WagerTransactionMapper.updateOrm(transaction, entity);

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

  async findByProviderKindAndReferenceExternalTransactionId(
    providerId: string,
    kind: WagerTransactionKind,
    referenceExternalTransactionId: string,
  ): Promise<WagerTransaction | undefined> {
    const entity = await this.entityManager.findOne(WagerTransactionOrmEntity, {
      providerId,
      kind,
      referenceExternalTransactionId,
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

  async findPendingReferencesDue(
    now: Date,
    limit: number,
  ): Promise<WagerTransaction[]> {
    const entities = await this.entityManager.find(
      WagerTransactionOrmEntity,
      {
        status: WagerTransactionStatus.PendingReference,
        nextReferenceRetryAt: { $lte: now },
      },
      {
        orderBy: {
          nextReferenceRetryAt: 'asc',
          createdAt: 'asc',
          id: 'asc',
        },
        limit,
      },
    );

    return entities.map(WagerTransactionMapper.toDomain);
  }
}
