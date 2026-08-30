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

const MIGRATION_NAME = 'Migration20260830000200_reference_hardening';
const WALLET_ID = '00000000-0000-4000-8000-000000001601';
const PLAYER_ID = '00000000-0000-4000-8000-000000001602';
const TRANSACTION_ID = '00000000-0000-4000-8000-000000001603';
const BET_ID = '00000000-0000-4000-8000-000000001604';
const REJECTED_REFUND_ID = '00000000-0000-4000-8000-000000001605';
const PROCESSED_REFUND_ID = '00000000-0000-4000-8000-000000001606';

let orm: MikroORM;

describe('reference hardening migration', () => {
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

  it('can migrate down and up with a rejected reversal followed by a processed correction', async () => {
    await openWalletFixture(orm, WALLET_ID, PLAYER_ID);
    const entityManager = orm.em.fork();
    const now = new Date('2026-08-30T12:00:00.000Z');
    const common = {
      providerId: 'provider-migration',
      walletId: WALLET_ID,
      playerId: PLAYER_ID,
      roundId: 'round-migration',
      gameId: 'game-migration',
      amount: '25.00',
      currency: 'BRL',
      observedBalance: '100.00',
      referenceRetryAttempts: 0,
      nextReferenceRetryAt: null,
      createdAt: now,
      processedAt: now,
    };
    const bet = entityManager.create(WagerTransactionOrmEntity, {
      ...common,
      id: BET_ID,
      externalTransactionId: 'migration-bet',
      idempotencyKey: 'provider-migration:migration-bet',
      payloadHash: 'hash:migration-bet',
      kind: WagerTransactionKind.Bet,
      referenceExternalTransactionId: null,
      referenceTransactionId: null,
      status: WagerTransactionStatus.Processed,
      failureCode: null,
    });
    const rejectedRefund = entityManager.create(WagerTransactionOrmEntity, {
      ...common,
      id: REJECTED_REFUND_ID,
      externalTransactionId: 'migration-refund-rejected',
      idempotencyKey: 'provider-migration:migration-refund-rejected',
      payloadHash: 'hash:migration-refund-rejected',
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: bet.externalTransactionId,
      referenceTransactionId: BET_ID,
      status: WagerTransactionStatus.Rejected,
      failureCode: 'REFERENCE_AMOUNT_MISMATCH',
    });
    const processedRefund = entityManager.create(WagerTransactionOrmEntity, {
      ...common,
      id: PROCESSED_REFUND_ID,
      externalTransactionId: 'migration-refund-processed',
      idempotencyKey: 'provider-migration:migration-refund-processed',
      payloadHash: 'hash:migration-refund-processed',
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: bet.externalTransactionId,
      referenceTransactionId: BET_ID,
      status: WagerTransactionStatus.Processed,
      failureCode: null,
    });

    entityManager.persist([bet, rejectedRefund, processedRefund]);
    await entityManager.flush();

    await expect(orm.migrator.down([MIGRATION_NAME])).resolves.toBeDefined();
    await expect(orm.migrator.up([MIGRATION_NAME])).resolves.toBeDefined();

    entityManager.clear();
    const reversals = await entityManager.find(WagerTransactionOrmEntity, {
      id: { $in: [REJECTED_REFUND_ID, PROCESSED_REFUND_ID] },
    });

    expect(reversals).toHaveLength(2);
  });
});
