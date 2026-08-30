import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';

import { MikroORM } from '@mikro-orm/postgresql';

import mikroOrmConfig from '@/mikro-orm.config.js';

import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../src/wagering/domain/wager-transaction.js';
import { WagerTransactionOrmEntity } from '../src/wagering/infrastructure/persistence/entities/wager-transaction.orm-entity.js';
import { openWalletFixture } from './support/financial-fixture.js';

const DATABASE_TESTS_ENABLED = process.env.RUN_DATABASE_TESTS === '1';
const describeWithDatabase = DATABASE_TESTS_ENABLED ? describe : describe.skip;

const MIGRATION_NAME = 'Migration20260830000200_reference_hardening';
const WALLET_ID = '00000000-0000-4000-8000-000000001601';
const PLAYER_ID = '00000000-0000-4000-8000-000000001602';
const TRANSACTION_ID = '00000000-0000-4000-8000-000000001603';

let orm: MikroORM;

describeWithDatabase('reference hardening migration', () => {
  beforeAll(async () => {
    orm = await MikroORM.init(mikroOrmConfig);
  });

  beforeEach(async () => {
    await orm.schema.clear({ truncate: true });
  });

  afterAll(async () => {
    const pendingMigrations = await orm.migrator.getPending();

    if (
      pendingMigrations.some((migration) => migration.name === MIGRATION_NAME)
    ) {
      await orm.migrator.up([MIGRATION_NAME]);
    }

    await orm.schema.clear({ truncate: true });
    await orm.close(true);
  });

  it('backfills existing pending retries and reverses the backfill on down', async () => {
    const migrator = orm.migrator;

    await migrator.down([MIGRATION_NAME]);

    try {
      await openWalletFixture(orm, WALLET_ID, PLAYER_ID);

      const entityManager = orm.em.fork();
      const createdAt = new Date('2026-08-30T12:00:00.000Z');
      const pending = entityManager.create(WagerTransactionOrmEntity, {
        id: TRANSACTION_ID,
        providerId: 'provider-migration',
        externalTransactionId: 'refund-before-reference',
        idempotencyKey: 'provider-migration:refund-before-reference',
        payloadHash: 'hash:refund-before-reference',
        walletId: WALLET_ID,
        playerId: PLAYER_ID,
        roundId: 'round-migration',
        gameId: 'game-migration',
        kind: WagerTransactionKind.Refund,
        amount: '25.00',
        currency: 'BRL',
        referenceExternalTransactionId: 'missing-bet',
        referenceTransactionId: null,
        status: WagerTransactionStatus.PendingReference,
        failureCode: null,
        observedBalance: '100.00',
        referenceRetryAttempts: 0,
        nextReferenceRetryAt: null,
        createdAt,
        processedAt: null,
      });

      entityManager.persist(pending);
      await entityManager.flush();
      await migrator.up([MIGRATION_NAME]);

      entityManager.clear();

      const backfilled = await entityManager.findOneOrFail(
        WagerTransactionOrmEntity,
        TRANSACTION_ID,
      );

      expect(backfilled.nextReferenceRetryAt).toEqual(createdAt);

      await migrator.down([MIGRATION_NAME]);
      entityManager.clear();

      const reverted = await entityManager.findOneOrFail(
        WagerTransactionOrmEntity,
        TRANSACTION_ID,
      );

      expect(reverted.nextReferenceRetryAt).toBeNull();
    } finally {
      const pendingMigrations = await migrator.getPending();

      if (
        pendingMigrations.some((migration) => migration.name === MIGRATION_NAME)
      ) {
        await migrator.up([MIGRATION_NAME]);
      }
    }
  });
});
