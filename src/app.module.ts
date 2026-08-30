import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { EntityManager } from '@mikro-orm/postgresql';

import { WalletController } from './wagering/presentation/http/controllers/wallet.controller.js';
import mikroOrmConfig from './mikro-orm.config.js';
import { OpenWalletUseCase } from './wagering/application/use-cases/open-wallet.use-case.js';
import { PendingReferenceWorker } from './wagering/infrastructure/workers/pending-reference.worker.js';

@Module({
  imports: [MikroOrmModule.forRoot(mikroOrmConfig)],
  controllers: [WalletController],
  providers: [
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
