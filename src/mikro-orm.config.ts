import { Migrator } from '@mikro-orm/migrations';
import { defineConfig } from '@mikro-orm/postgresql';
import { WalletOrmEntity } from './wagering/infrastructure/persistence/entities/wallet.orm-entity.js';
import { WagerTransactionOrmEntity } from './wagering/infrastructure/persistence/entities/wager-transaction.orm-entity.js';
import { WalletLedgerEntryOrmEntity } from './wagering/infrastructure/persistence/entities/wallet-ledger-entry.orm-entity.js';
import { InboxMessageOrmEntity } from './wagering/infrastructure/persistence/entities/inbox-message.orm-entity.js';
import { OutboxMessageOrmEntity } from './wagering/infrastructure/persistence/entities/outbox-message.orm-entity.js';
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';

export default defineConfig({
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  user: process.env.POSTGRES_USER ?? 'postgres',
  password: process.env.POSTGRES_PASSWORD ?? 'postgres',
  dbName: process.env.POSTGRES_DB ?? 'wagering',

  entities: [
    WalletOrmEntity,
    WagerTransactionOrmEntity,
    WalletLedgerEntryOrmEntity,
    InboxMessageOrmEntity,
    OutboxMessageOrmEntity,
  ],

  metadataProvider: ReflectMetadataProvider,

  discovery: {
    warnWhenNoEntities: false,
  },
  migrations: {
    path: './dist/migrations',
    pathTs: './src/migrations',
  },
  extensions: [Migrator],
});
