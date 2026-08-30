import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import type { EntityManager } from '@mikro-orm/postgresql';

import { MikroOrmOutboxMessageRepository } from '../persistence/repositories/mikro-orm-outbox-message.repository.js';

const POLL_INTERVAL_MS = 1_000;
const DEFAULT_BATCH_SIZE = 100;

export interface OutboxPublishResult {
  published: number;
  retried: number;
}

export class OutboxPublisherWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisherWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly entityManager: EntityManager,
    private readonly sqsClient: SQSClient,
    private readonly queueUrl: string,
    private readonly batchSize = DEFAULT_BATCH_SIZE,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async runOnce(now: Date = new Date()): Promise<OutboxPublishResult> {
    const result: OutboxPublishResult = { published: 0, retried: 0 };

    for (let index = 0; index < this.batchSize; index++) {
      const outcome = await this.publishNext(now);

      if (!outcome) {
        break;
      }

      result[outcome]++;
    }

    return result;
  }

  private publishNext(now: Date): Promise<'published' | 'retried' | undefined> {
    return this.entityManager.fork().transactional(async (tx) => {
      const repository = new MikroOrmOutboxMessageRepository(tx);
      const message = await repository.findNextDue(now);

      if (!message) {
        return;
      }

      try {
        await this.sqsClient.send(
          new SendMessageCommand({
            QueueUrl: this.queueUrl,
            MessageBody: JSON.stringify(message.payload),
            MessageGroupId: message.aggregateId,
            MessageDeduplicationId: message.id,
          }),
        );
      } catch {
        message.scheduleRetry(now);
        await repository.update(message);

        return 'retried';
      }

      message.markPublished(new Date());
      await repository.update(message);

      return 'published';
    });
  }

  private async tick(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    try {
      await this.runOnce();
    } catch (error) {
      this.logger.error(error instanceof Error ? error.stack : String(error));
    } finally {
      this.running = false;
    }
  }
}
