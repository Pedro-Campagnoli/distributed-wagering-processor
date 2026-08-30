import { LockMode } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';

import type { OutboxMessage } from '../../../domain/outbox-message.js';
import { OutboxMessageOrmEntity } from '../entities/outbox-message.orm-entity.js';
import { OutboxMessageMapper } from '../mappers/outbox-message.mapper.js';

export class MikroOrmOutboxMessageRepository {
  constructor(private readonly entityManager: EntityManager) {}

  async insert(messages: readonly OutboxMessage[]): Promise<void> {
    for (const message of messages) {
      this.entityManager.persist(OutboxMessageMapper.toOrm(message));
    }

    await this.entityManager.flush();
  }

  async findNextDue(now: Date): Promise<OutboxMessage | undefined> {
    const entity = await this.entityManager.findOne(
      OutboxMessageOrmEntity,
      {
        publishedAt: null,
        $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
      },
      {
        orderBy: {
          nextAttemptAt: 'asc',
          occurredAt: 'asc',
          id: 'asc',
        },
        lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE,
      },
    );

    return entity ? OutboxMessageMapper.toDomain(entity) : undefined;
  }

  async update(message: OutboxMessage): Promise<void> {
    const entity = await this.entityManager.findOne(
      OutboxMessageOrmEntity,
      message.id,
    );

    if (!entity) {
      return;
    }

    OutboxMessageMapper.updateOrm(message, entity);
    await this.entityManager.flush();
  }
}
