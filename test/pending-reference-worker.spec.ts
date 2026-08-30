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
  MAX_REFERENCE_RETRY_ATTEMPTS,
  ProcessWagerTransactionUseCase,
  REFERENCE_RETRY_BASE_DELAY_MS,
} from '../src/wagering/application/use-cases/process-wager-transaction.use-case.js';
import { Money } from '../src/wagering/domain/money.js';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../src/wagering/domain/wager-transaction.js';
import { LedgerDirection } from '../src/wagering/domain/wallet-ledger-entry.js';
import { WagerTransactionOrmEntity } from '../src/wagering/infrastructure/persistence/entities/wager-transaction.orm-entity.js';
import { WalletLedgerEntryOrmEntity } from '../src/wagering/infrastructure/persistence/entities/wallet-ledger-entry.orm-entity.js';
import { WalletOrmEntity } from '../src/wagering/infrastructure/persistence/entities/wallet.orm-entity.js';
import { PendingReferenceWorker } from '../src/wagering/infrastructure/workers/pending-reference.worker.js';
import {
  expectWalletBalanceMatchesLedger,
  openWalletFixture,
} from './support/financial-fixture.js';

const WALLET_ID = '00000000-0000-4000-8000-000000001501';
const PLAYER_ID = '00000000-0000-4000-8000-000000001502';
const PROVIDER_ID = 'provider-pending-worker';

let orm: MikroORM;
let worker: PendingReferenceWorker;

function createInput(
  kind: WagerTransactionKind,
  externalTransactionId: string,
  referenceExternalTransactionId?: string,
) {
  return {
    providerId: PROVIDER_ID,
    externalTransactionId,
    idempotencyKey: `${PROVIDER_ID}:${externalTransactionId}`,
    walletId: WALLET_ID,
    playerId: PLAYER_ID,
    roundId: 'round-pending-worker',
    gameId: 'game-pending-worker',
    kind,
    money: Money.from({
      amount: '25.00',
      currency: 'BRL',
    }),
    referenceExternalTransactionId,
  };
}

function execute(input: ReturnType<typeof createInput>) {
  return new ProcessWagerTransactionUseCase(orm.em.fork()).execute(input);
}

async function persistedState() {
  const entityManager = orm.em.fork();

  const [wallet, transactions, ledgerEntries] = await Promise.all([
    entityManager.findOne(WalletOrmEntity, WALLET_ID),
    entityManager.find(WagerTransactionOrmEntity, { walletId: WALLET_ID }),
    entityManager.find(WalletLedgerEntryOrmEntity, { walletId: WALLET_ID }),
  ]);

  expectWalletBalanceMatchesLedger(wallet, ledgerEntries);

  return {
    wallet,
    transactions,
    ledgerEntries,
  };
}

async function createPendingRefundAndReference() {
  const pending = await execute(
    createInput(WagerTransactionKind.Refund, 'refund-before-bet', 'late-bet'),
  );
  const reference = await execute(
    createInput(WagerTransactionKind.Bet, 'late-bet'),
  );

  return { pending, reference };
}

describe('PendingReferenceWorker', () => {
  beforeAll(async () => {
    orm = await MikroORM.init(mikroOrmConfig);
    worker = new PendingReferenceWorker(orm.em);
  });

  beforeEach(async () => {
    await orm.schema.clear({ truncate: true });

    await openWalletFixture(orm, WALLET_ID, PLAYER_ID);
  });

  afterAll(async () => {
    await orm.schema.clear({ truncate: true });
    await orm.close(true);
  });

  it('processes the pending transaction when its reference appears', async () => {
    const { pending, reference } = await createPendingRefundAndReference();

    await worker.runOnce(new Date(Date.now() + 60_000));

    const state = await persistedState();
    const processed = state.transactions.find(
      (transaction) => transaction.id === pending.transaction.id,
    );
    const ledgerEntries = state.ledgerEntries.filter(
      (entry) => entry.transactionId === pending.transaction.id,
    );

    expect(state.transactions).toHaveLength(3);
    expect(processed?.status).toBe(WagerTransactionStatus.Processed);
    expect(processed?.referenceTransactionId).toBe(reference.transaction.id);
    expect(processed?.observedBalance).toBe('100.00');
    expect(processed?.processedAt).toBeInstanceOf(Date);
    expect(state.wallet?.balance).toBe('100.00');
    expect(ledgerEntries).toHaveLength(1);
    expect(ledgerEntries[0]?.direction).toBe(LedgerDirection.Credit);
  });

  it('keeps the transaction pending while the reference is missing', async () => {
    const pending = await execute(
      createInput(
        WagerTransactionKind.Rollback,
        'rollback-still-pending',
        'missing-win',
      ),
    );
    const now = new Date(Date.now() + 60_000);

    await worker.runOnce(now);

    const state = await persistedState();
    const unchanged = state.transactions.find(
      (transaction) => transaction.id === pending.transaction.id,
    );

    expect(unchanged?.status).toBe(WagerTransactionStatus.PendingReference);
    expect(unchanged?.failureCode).toBeNull();
    expect(unchanged?.referenceRetryAttempts).toBe(1);
    expect(unchanged?.nextReferenceRetryAt?.getTime()).toBe(
      now.getTime() + REFERENCE_RETRY_BASE_DELAY_MS * 2,
    );
    expect(state.wallet?.balance).toBe('100.00');
    expect(state.ledgerEntries).toHaveLength(1);

    const secondRunAt = unchanged?.nextReferenceRetryAt;

    if (!secondRunAt) {
      throw new Error('Expected the next reference retry to be scheduled');
    }

    await worker.runOnce(secondRunAt);

    const retriedState = await persistedState();
    const retried = retriedState.transactions.find(
      (transaction) => transaction.id === pending.transaction.id,
    );

    expect(retried?.status).toBe(WagerTransactionStatus.PendingReference);
    expect(retried?.referenceRetryAttempts).toBe(2);
    expect(retried?.nextReferenceRetryAt?.getTime()).toBe(
      secondRunAt.getTime() + REFERENCE_RETRY_BASE_DELAY_MS * 4,
    );
    expect(retriedState.wallet?.balance).toBe('100.00');
    expect(retriedState.ledgerEntries).toHaveLength(1);
  });

  it('increments a due retry only once across concurrent workers', async () => {
    const pending = await execute(
      createInput(
        WagerTransactionKind.Refund,
        'refund-concurrent-retry',
        'missing-concurrent-bet',
      ),
    );
    const runAt = new Date(Date.now() + 60_000);
    const workers = Array.from(
      { length: 5 },
      () => new PendingReferenceWorker(orm.em),
    );

    await Promise.all(
      workers.map((currentWorker) => currentWorker.runOnce(runAt)),
    );

    const state = await persistedState();
    const retried = state.transactions.find(
      (transaction) => transaction.id === pending.transaction.id,
    );

    expect(retried?.status).toBe(WagerTransactionStatus.PendingReference);
    expect(retried?.referenceRetryAttempts).toBe(1);
    expect(retried?.nextReferenceRetryAt?.getTime()).toBe(
      runAt.getTime() + REFERENCE_RETRY_BASE_DELAY_MS * 2,
    );
    expect(state.wallet?.balance).toBe('100.00');
    expect(state.ledgerEntries).toHaveLength(1);
  });

  it('waits for an in-flight retry during graceful shutdown', async () => {
    await execute(
      createInput(
        WagerTransactionKind.Refund,
        'refund-shutdown',
        'missing-shutdown-bet',
      ),
    );
    const originalReprocessPending =
      ProcessWagerTransactionUseCase.prototype.reprocessPending;
    let releaseRetry!: () => void;
    let signalRetryStarted!: () => void;
    const retryReleased = new Promise<void>((resolve) => {
      releaseRetry = resolve;
    });
    const retryStarted = new Promise<void>((resolve) => {
      signalRetryStarted = resolve;
    });

    ProcessWagerTransactionUseCase.prototype.reprocessPending = async function (
      transactionId,
      walletId,
      now,
    ) {
      signalRetryStarted();
      await retryReleased;
      return originalReprocessPending.call(this, transactionId, walletId, now);
    };

    const shuttingDownWorker = new PendingReferenceWorker(orm.em);

    try {
      const retrying = shuttingDownWorker.runOnce(
        new Date(Date.now() + 60_000),
      );
      await retryStarted;
      let shutdownCompleted = false;
      const shutdown = shuttingDownWorker.onModuleDestroy().then(() => {
        shutdownCompleted = true;
      });

      await Bun.sleep(10);
      expect(shutdownCompleted).toBe(false);

      releaseRetry();
      await Promise.all([retrying, shutdown]);
      expect(shutdownCompleted).toBe(true);
    } finally {
      ProcessWagerTransactionUseCase.prototype.reprocessPending =
        originalReprocessPending;
    }
  });

  it('does not duplicate balance or ledger on repeated worker executions', async () => {
    const { pending } = await createPendingRefundAndReference();
    const firstRunAt = new Date(Date.now() + 60_000);

    await worker.runOnce(firstRunAt);
    await worker.runOnce(new Date(firstRunAt.getTime() + 60_000));

    const state = await persistedState();
    const processed = state.transactions.filter(
      (transaction) => transaction.id === pending.transaction.id,
    );
    const ledgerEntries = state.ledgerEntries.filter(
      (entry) => entry.transactionId === pending.transaction.id,
    );

    expect(processed).toHaveLength(1);
    expect(processed[0]?.status).toBe(WagerTransactionStatus.Processed);
    expect(state.wallet?.balance).toBe('100.00');
    expect(ledgerEntries).toHaveLength(1);
  });

  it('rejects the transaction after the retry limit is exhausted', async () => {
    const pending = await execute(
      createInput(
        WagerTransactionKind.Refund,
        'refund-exhausted',
        'missing-bet-forever',
      ),
    );
    const firstRunAt = Date.now() + 60_000;

    for (let attempt = 0; attempt < MAX_REFERENCE_RETRY_ATTEMPTS; attempt++) {
      await worker.runOnce(new Date(firstRunAt + attempt * 60_000));
    }

    const state = await persistedState();
    const rejected = state.transactions.find(
      (transaction) => transaction.id === pending.transaction.id,
    );

    expect(rejected?.status).toBe(WagerTransactionStatus.Rejected);
    expect(rejected?.failureCode).toBe('REFERENCE_NOT_FOUND_AFTER_RETRIES');
    expect(rejected?.referenceRetryAttempts).toBe(MAX_REFERENCE_RETRY_ATTEMPTS);
    expect(rejected?.nextReferenceRetryAt).toBeNull();
    expect(state.wallet?.balance).toBe('100.00');
    expect(state.ledgerEntries).toHaveLength(1);
  });
});
