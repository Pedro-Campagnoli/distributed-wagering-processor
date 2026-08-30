import { Module } from '@nestjs/common';
import { SQSClient } from '@aws-sdk/client-sqs';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { EntityManager } from '@mikro-orm/postgresql';

import { WalletController } from './wagering/presentation/http/controllers/wallet.controller.js';
import mikroOrmConfig from './mikro-orm.config.js';
import { OpenWalletUseCase } from './wagering/application/use-cases/open-wallet.use-case.js';
import { PendingReferenceWorker } from './wagering/infrastructure/workers/pending-reference.worker.js';
import {
  createSqsClient,
  getWagerQueueUrl,
} from './wagering/infrastructure/messaging/sqs-client.js';
import { WagerTransactionConsumer } from './wagering/infrastructure/messaging/wager-transaction.consumer.js';
import { WagerTransactionProducer } from './wagering/infrastructure/messaging/wager-transaction.producer.js';

@Module({
  imports: [MikroOrmModule.forRoot(mikroOrmConfig)],
  controllers: [WalletController],
  providers: [
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
      provide: PendingReferenceWorker,
      inject: [EntityManager],
      useFactory: (entityManager: EntityManager) =>
        new PendingReferenceWorker(entityManager),
    },
  ],
})
export class AppModule {}
