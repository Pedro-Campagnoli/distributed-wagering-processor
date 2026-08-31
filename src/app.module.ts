import { Module } from '@nestjs/common';
import { SQSClient } from '@aws-sdk/client-sqs';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { EntityManager } from '@mikro-orm/postgresql';

import { WalletController } from './wagering/presentation/http/controllers/wallet.controller.js';
import { WageringController } from './wagering/presentation/http/controllers/wagering.controller.js';
import { HealthController } from './wagering/presentation/http/controllers/health.controller.js';
import { MetricsController } from './wagering/presentation/http/controllers/metrics.controller.js';
import mikroOrmConfig from './mikro-orm.config.js';
import { OpenWalletUseCase } from './wagering/application/use-cases/open-wallet.use-case.js';
import { PendingReferenceWorker } from './wagering/infrastructure/workers/pending-reference.worker.js';
import {
  createSqsClient,
  getWagerEventsQueueUrl,
  getWagerQueueUrl,
} from './wagering/infrastructure/messaging/sqs-client.js';
import { WagerTransactionConsumer } from './wagering/infrastructure/messaging/wager-transaction.consumer.js';
import { WagerTransactionProducer } from './wagering/infrastructure/messaging/wager-transaction.producer.js';
import { OutboxPublisherWorker } from './wagering/infrastructure/workers/outbox-publisher.worker.js';
import { ProcessWagerTransactionUseCase } from './wagering/application/use-cases/process-wager-transaction.use-case.js';
import { WageringQueryService } from './wagering/application/services/wagering-query.service.js';
import {
  OperationalMetrics,
  operationalMetrics,
} from './wagering/infrastructure/observability/operational-metrics.js';

@Module({
  imports: [MikroOrmModule.forRoot(mikroOrmConfig)],
  controllers: [
    WalletController,
    WageringController,
    HealthController,
    MetricsController,
  ],
  providers: [
    {
      provide: OperationalMetrics,
      useValue: operationalMetrics,
    },
    {
      provide: SQSClient,
      useFactory: createSqsClient,
    },
    {
      provide: WagerTransactionProducer,
      inject: [SQSClient],
      useFactory: (sqsClient: SQSClient) =>
        new WagerTransactionProducer(sqsClient, getWagerQueueUrl()),
    },
    {
      provide: WagerTransactionConsumer,
      inject: [EntityManager, SQSClient],
      useFactory: (entityManager: EntityManager, sqsClient: SQSClient) =>
        new WagerTransactionConsumer(
          entityManager,
          sqsClient,
          getWagerQueueUrl(),
        ),
    },
    {
      provide: OpenWalletUseCase,
      inject: [EntityManager],
      useFactory: (entityManager: EntityManager) =>
        new OpenWalletUseCase(entityManager),
    },
    {
      provide: ProcessWagerTransactionUseCase,
      inject: [EntityManager],
      useFactory: (entityManager: EntityManager) =>
        new ProcessWagerTransactionUseCase(entityManager),
    },
    {
      provide: WageringQueryService,
      inject: [EntityManager, OperationalMetrics],
      useFactory: (entityManager: EntityManager, metrics: OperationalMetrics) =>
        new WageringQueryService(entityManager, metrics),
    },
    {
      provide: PendingReferenceWorker,
      inject: [EntityManager],
      useFactory: (entityManager: EntityManager) =>
        new PendingReferenceWorker(entityManager),
    },
    {
      provide: OutboxPublisherWorker,
      inject: [EntityManager, SQSClient],
      useFactory: (entityManager: EntityManager, sqsClient: SQSClient) =>
        new OutboxPublisherWorker(
          entityManager,
          sqsClient,
          getWagerEventsQueueUrl(),
        ),
    },
  ],
})
export class AppModule {}
