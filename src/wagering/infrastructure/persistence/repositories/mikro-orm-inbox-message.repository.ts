import type { EntityManager } from '@mikro-orm/postgresql';

import { InboxMessageOrmEntity } from '../entities/inbox-message.orm-entity.js';

export class MikroOrmInboxMessageRepository {
  constructor(private readonly entityManager: EntityManager) {}

  async find(
    consumerName: string,
    messageId: string,
  ): Promise<InboxMessageOrmEntity | undefined> {
    const message = await this.entityManager.findOne(InboxMessageOrmEntity, {
      consumerName,
      messageId,
    });

    return message ?? undefined;
  }

  async insert(message: InboxMessageOrmEntity): Promise<void> {
    this.entityManager.persist(message);
    await this.entityManager.flush();
  }

  async markProcessed(
    message: InboxMessageOrmEntity,
    processedAt: Date,
  ): Promise<void> {
    message.processedAt = processedAt;
    await this.entityManager.flush();
  }
}
