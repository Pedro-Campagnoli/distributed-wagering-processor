import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';
import { EntityManager } from '@mikro-orm/postgresql';

import { WalletOrmEntity } from '../../../infrastructure/persistence/entities/wallet.orm-entity.js';
import { OperationalMetrics } from '../../../infrastructure/observability/operational-metrics.js';
import {
  getWagerDlqUrl,
  getWagerQueueUrl,
} from '../../../infrastructure/messaging/sqs-client.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly entityManager: EntityManager,
    private readonly sqsClient: SQSClient,
    private readonly metrics: OperationalMetrics,
  ) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    const checks = {
      postgres: 'up',
      sqs: 'up',
    };

    try {
      await this.entityManager.fork().count(WalletOrmEntity, {});
    } catch {
      checks.postgres = 'down';
    }

    try {
      const [, dlq] = await Promise.all([
        this.sqsClient.send(
          new GetQueueAttributesCommand({
            QueueUrl: getWagerQueueUrl(),
            AttributeNames: ['QueueArn'],
          }),
        ),
        this.sqsClient.send(
          new GetQueueAttributesCommand({
            QueueUrl: getWagerDlqUrl(),
            AttributeNames: ['ApproximateNumberOfMessages'],
          }),
        ),
      ]);
      this.metrics.setDlqMessages(
        Number(dlq.Attributes?.ApproximateNumberOfMessages ?? 0),
      );
    } catch {
      checks.sqs = 'down';
    }

    if (checks.postgres === 'down' || checks.sqs === 'down') {
      throw new ServiceUnavailableException({ status: 'error', checks });
    }

    return { status: 'ok', checks };
  }
}
