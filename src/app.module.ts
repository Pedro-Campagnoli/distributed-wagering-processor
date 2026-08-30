import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { EntityManager } from '@mikro-orm/postgresql';

import { WalletController } from './wallet/wallet.controller.js';
import mikroOrmConfig from './mikro-orm.config.js';
import { OpenWalletUseCase } from './shared/application/use-cases/open-wallet.use-case.js';

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
  ],
})
export class AppModule {}
