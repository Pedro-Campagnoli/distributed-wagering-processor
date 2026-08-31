import { randomUUID } from 'node:crypto';

import {
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import { MikroORM } from '@mikro-orm/postgresql';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';

import mikroOrmConfig from '@/mikro-orm.config.js';
import { ProcessWagerTransactionUseCase } from '../src/wagering/application/use-cases/process-wager-transaction.use-case.js';
import { Money } from '../src/wagering/domain/money.js';
import { WagerTransactionKind } from '../src/wagering/domain/wager-transaction.js';
import {
  createSqsClient,
  getWagerEventsQueueUrl,
} from '../src/wagering/infrastructure/messaging/sqs-client.js';
import { OutboxMessageOrmEntity } from '../src/wagering/infrastructure/persistence/entities/outbox-message.orm-entity.js';
import { WagerTransactionOrmEntity } from '../src/wagering/infrastructure/persistence/entities/wager-transaction.orm-entity.js';
import { WalletLedgerEntryOrmEntity } from '../src/wagering/infrastructure/persistence/entities/wallet-ledger-entry.orm-entity.js';
import { WalletOrmEntity } from '../src/wagering/infrastructure/persistence/entities/wallet.orm-entity.js';
import { MikroOrmOutboxMessageRepository } from '../src/wagering/infrastructure/persistence/repositories/mikro-orm-outbox-message.repository.js';
import { OutboxPublisherWorker } from '../src/wagering/infrastructure/workers/outbox-publisher.worker.js';
import {
  expectWalletBalanceMatchesLedger,
  openWalletFixture,
} from './support/financial-fixture.js';

const WALLET_ID = '00000000-0000-4000-8000-000000001801';
const PLAYER_ID = '00000000-0000-4000-8000-000000001802';
const PROVIDER_ID = 'provider-outbox';

let orm: MikroORM;
let sqsClient: SQSClient;

function createInput(
  kind: WagerTransactionKind,
  amount = '25.00',
  referenceExternalTransactionId?: string,
) {
  const externalTransactionId = `outbox-${kind.toLowerCase()}-${randomUUID()}`;

  return {
    providerId: PROVIDER_ID,
    externalTransactionId,
    idempotencyKey: `${PROVIDER_ID}:${externalTransactionId}`,
    walletId: WALLET_ID,
    playerId: PLAYER_ID,
    roundId: 'round-outbox',
    gameId: 'game-outbox',
    kind,
    money: Money.from({ amount, currency: 'BRL' }),
    referenceExternalTransactionId,
  };
}

async function process(input: ReturnType<typeof createInput>) {
  return new ProcessWagerTransactionUseCase(orm.em.fork()).execute(input);
}

async function drainEventsQueue(): Promise<void> {
  while (true) {
    const response = await sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: getWagerEventsQueueUrl(),
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 0,
        VisibilityTimeout: 1,
      }),
    );
    const messages = response.Messages ?? [];

    if (messages.length === 0) {
      return;
    }

    await Promise.all(
      messages.map((message) =>
        sqsClient.send(
          new DeleteMessageCommand({
            QueueUrl: getWagerEventsQueueUrl(),
            ReceiptHandle: message.ReceiptHandle!,
          }),
        ),
      ),
    );
  }
}

async function receiveEvents(
  expected: number,
): Promise<Record<string, unknown>[]> {
  const events: Record<string, unknown>[] = [];

  for (let attempt = 0; attempt < 5 && events.length < expected; attempt++) {
    const response = await sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: getWagerEventsQueueUrl(),
        MaxNumberOfMessages: Math.min(10, expected - events.length),
        WaitTimeSeconds: 1,
        VisibilityTimeout: 30,
      }),
    );

    for (const message of response.Messages ?? []) {
      events.push(JSON.parse(message.Body!) as Record<string, unknown>);
      await sqsClient.send(
        new DeleteMessageCommand({
          QueueUrl: getWagerEventsQueueUrl(),
          ReceiptHandle: message.ReceiptHandle!,
        }),
      );
    }
  }

  return events;
}

async function clearOpeningOutbox(): Promise<void> {
  await orm.em.fork().nativeDelete(OutboxMessageOrmEntity, {});
}

async function expectFinancialInvariant(): Promise<void> {
  const entityManager = orm.em.fork();
  const [wallet, ledgerEntries] = await Promise.all([
    entityManager.findOne(WalletOrmEntity, WALLET_ID),
    entityManager.find(WalletLedgerEntryOrmEntity, { walletId: WALLET_ID }),
  ]);

  expectWalletBalanceMatchesLedger(wallet, ledgerEntries);
}

describe('Transactional Outbox with PostgreSQL and LocalStack', () => {
  beforeAll(async () => {
    orm = await MikroORM.init(mikroOrmConfig);
    sqsClient = createSqsClient();
  });

  beforeEach(async () => {
    await drainEventsQueue();
    await orm.schema.clear({ truncate: true });
    await openWalletFixture(orm, WALLET_ID, PLAYER_ID);
    await clearOpeningOutbox();
  });

  afterAll(async () => {
    await drainEventsQueue();
    await orm.schema.clear({ truncate: true });
    await orm.close(true);
    sqsClient.destroy();
  });

  it('exposes the FIFO integration-events queue in LocalStack', async () => {
    const response = await sqsClient.send(
      new GetQueueAttributesCommand({
        QueueUrl: getWagerEventsQueueUrl(),
        AttributeNames: ['FifoQueue'],
      }),
    );

    expect(response.Attributes?.FifoQueue).toBe('true');
  });

  it('persists the event set atomically and only emits balance changes for real movements', async () => {
    const processed = await process(createInput(WagerTransactionKind.Bet));
    const rejected = await process(
      createInput(WagerTransactionKind.Bet, '500.00'),
    );
    const loss = await process(createInput(WagerTransactionKind.Loss));
    const pending = await process(
      createInput(WagerTransactionKind.Refund, '25.00', 'missing-bet'),
    );
    const entityManager = orm.em.fork();
    const outbox = await entityManager.find(
      OutboxMessageOrmEntity,
      {},
      { orderBy: { occurredAt: 'asc' } },
    );

    const eventsFor = (transactionId: string) =>
      outbox.filter(
        (message) =>
          (message.payload.data as { transactionId?: string }).transactionId ===
          transactionId,
      );

    expect(
      eventsFor(processed.transaction.id).map((event) => event.eventType),
    ).toEqual(['WagerTransactionProcessed', 'WalletBalanceChanged']);
    expect(
      eventsFor(rejected.transaction.id).map((event) => event.eventType),
    ).toEqual(['WagerTransactionRejected']);
    expect(
      eventsFor(loss.transaction.id).map((event) => event.eventType),
    ).toEqual(['WagerTransactionProcessed']);
    expect(
      eventsFor(pending.transaction.id).map((event) => event.eventType),
    ).toEqual(['WagerTransactionPendingReference']);

    const balanceEvent = eventsFor(processed.transaction.id).find(
      (event) => event.eventType === 'WalletBalanceChanged',
    );
    const balanceData = balanceEvent?.payload.data as {
      money: { amount: unknown };
      balanceBefore: { amount: unknown };
      balanceAfter: { amount: unknown };
    };

    expect(balanceData.money.amount).toBe('25.00');
    expect(balanceData.balanceBefore.amount).toBe('100.00');
    expect(balanceData.balanceAfter.amount).toBe('75.00');
    expect(typeof balanceData.money.amount).toBe('string');
    expect(outbox.every((message) => message.publishedAt === null)).toBe(true);
    await expectFinancialInvariant();
  });

  it('rolls back wallet, transaction, ledger and Outbox when Outbox persistence fails', async () => {
    const originalInsert = MikroOrmOutboxMessageRepository.prototype.insert;

    MikroOrmOutboxMessageRepository.prototype.insert = async function (
      messages,
    ) {
      await originalInsert.call(this, messages);
      throw new Error('Simulated Outbox persistence failure');
    };

    try {
      await expect(
        process(createInput(WagerTransactionKind.Bet)),
      ).rejects.toThrow('Simulated Outbox persistence failure');
    } finally {
      MikroOrmOutboxMessageRepository.prototype.insert = originalInsert;
    }

    const entityManager = orm.em.fork();
    const [wallet, wagers, ledgerEntries, outboxCount] = await Promise.all([
      entityManager.findOne(WalletOrmEntity, WALLET_ID),
      entityManager.find(WagerTransactionOrmEntity, {
        walletId: WALLET_ID,
        kind: WagerTransactionKind.Bet,
      }),
      entityManager.find(WalletLedgerEntryOrmEntity, { walletId: WALLET_ID }),
      entityManager.count(OutboxMessageOrmEntity, {}),
    ]);

    expect(wallet?.balance).toBe('100.00');
    expect(wagers).toHaveLength(0);
    expect(ledgerEntries).toHaveLength(1);
    expect(outboxCount).toBe(0);
    expectWalletBalanceMatchesLedger(wallet, ledgerEntries);
  });

  it('publishes committed PROCESSED and WalletBalanceChanged events and marks them', async () => {
    const result = await process(createInput(WagerTransactionKind.Bet));
    const publisher = new OutboxPublisherWorker(
      orm.em,
      sqsClient,
      getWagerEventsQueueUrl(),
    );

    const pendingBeforePublish = await orm.em
      .fork()
      .count(OutboxMessageOrmEntity, { publishedAt: null });
    const publishResult = await publisher.runOnce();
    const messages = await receiveEvents(2);
    const persisted = await orm.em.fork().find(OutboxMessageOrmEntity, {});

    expect(pendingBeforePublish).toBe(2);
    expect(publishResult).toEqual({ published: 2, retried: 0 });
    expect(messages.map((event) => event.eventType).sort()).toEqual([
      'WagerTransactionProcessed',
      'WalletBalanceChanged',
    ]);
    expect(
      messages.every(
        (event) =>
          (event.data as { transactionId?: string }).transactionId ===
          result.transaction.id,
      ),
    ).toBe(true);
    expect(
      persisted.every((message) => message.publishedAt instanceof Date),
    ).toBe(true);
    await expectFinancialInvariant();
  });

  it('publishes REJECTED and PENDING_REFERENCE events', async () => {
    await process(createInput(WagerTransactionKind.Bet, '500.00'));
    await process(
      createInput(WagerTransactionKind.Rollback, '25.00', 'missing-reference'),
    );
    const publisher = new OutboxPublisherWorker(
      orm.em,
      sqsClient,
      getWagerEventsQueueUrl(),
    );

    await publisher.runOnce();
    const messages = await receiveEvents(2);

    expect(messages.map((event) => event.eventType).sort()).toEqual([
      'WagerTransactionPendingReference',
      'WagerTransactionRejected',
    ]);
    await expectFinancialInvariant();
  });

  it('publishes committed events after the original publisher is replaced', async () => {
    await process(createInput(WagerTransactionKind.Loss));
    const stoppedPublisher = new OutboxPublisherWorker(
      orm.em,
      sqsClient,
      getWagerEventsQueueUrl(),
    );

    await stoppedPublisher.onModuleDestroy();

    const replacementPublisher = new OutboxPublisherWorker(
      orm.em,
      sqsClient,
      getWagerEventsQueueUrl(),
    );
    const result = await replacementPublisher.runOnce();
    const messages = await receiveEvents(1);
    const persisted = await orm.em.fork().find(OutboxMessageOrmEntity, {});

    expect(result).toEqual({ published: 1, retried: 0 });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.eventType).toBe('WagerTransactionProcessed');
    expect(persisted[0]?.publishedAt).toBeInstanceOf(Date);
    await expectFinancialInvariant();
  });

  it('lets two publishers claim distinct pending rows without losing events', async () => {
    const operationCount = 8;

    for (let index = 0; index < operationCount; index++) {
      await process(createInput(WagerTransactionKind.Loss));
    }

    const firstPublisher = new OutboxPublisherWorker(
      orm.em,
      sqsClient,
      getWagerEventsQueueUrl(),
      operationCount,
    );
    const secondPublisher = new OutboxPublisherWorker(
      orm.em,
      sqsClient,
      getWagerEventsQueueUrl(),
      operationCount,
    );

    const results = await Promise.all([
      firstPublisher.runOnce(),
      secondPublisher.runOnce(),
    ]);
    const persisted = await orm.em.fork().find(OutboxMessageOrmEntity, {});
    const messages = await receiveEvents(operationCount);

    expect(results.reduce((sum, result) => sum + result.published, 0)).toBe(
      operationCount,
    );
    expect(persisted).toHaveLength(operationCount);
    expect(
      persisted.every((message) => message.publishedAt instanceof Date),
    ).toBe(true);
    expect(new Set(messages.map((event) => event.eventId)).size).toBe(
      operationCount,
    );
    await expectFinancialInvariant();
  });

  it('keeps a failed publication pending and retries it only after backoff', async () => {
    await process(createInput(WagerTransactionKind.Loss));
    const failingClient = createSqsClient();
    let shouldFail = true;

    failingClient.middlewareStack.add(
      (next, context) => async (args) => {
        if (context.commandName === 'SendMessageCommand' && shouldFail) {
          shouldFail = false;
          throw new Error('Simulated SQS publication failure');
        }

        return next(args);
      },
      { step: 'initialize', name: 'failFirstOutboxPublication' },
    );

    const publisher = new OutboxPublisherWorker(
      orm.em,
      failingClient,
      getWagerEventsQueueUrl(),
      1,
    );
    const now = new Date('2026-08-30T12:00:00.000Z');

    const failed = await publisher.runOnce(now);
    let persisted = (await orm.em.fork().find(OutboxMessageOrmEntity, {}))[0];

    expect(failed).toEqual({ published: 0, retried: 1 });
    expect(persisted?.attempts).toBe(1);
    expect(persisted?.nextAttemptAt?.toISOString()).toBe(
      '2026-08-30T12:00:01.000Z',
    );
    expect(persisted?.publishedAt).toBeNull();

    expect(await publisher.runOnce(now)).toEqual({ published: 0, retried: 0 });

    const retried = await publisher.runOnce(
      new Date('2026-08-30T12:00:01.000Z'),
    );
    persisted = (await orm.em.fork().find(OutboxMessageOrmEntity, {}))[0];
    const messages = await receiveEvents(1);

    expect(retried).toEqual({ published: 1, retried: 0 });
    expect(persisted?.attempts).toBe(1);
    expect(persisted?.nextAttemptAt).toBeNull();
    expect(persisted?.publishedAt).toBeInstanceOf(Date);
    expect(messages).toHaveLength(1);
    failingClient.destroy();
    await expectFinancialInvariant();
  });

  it('waits for an in-flight publication during graceful shutdown', async () => {
    await process(createInput(WagerTransactionKind.Loss));
    const delayedClient = createSqsClient();
    let releaseSend!: () => void;
    let signalSendStarted!: () => void;
    const sendReleased = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    const sendStarted = new Promise<void>((resolve) => {
      signalSendStarted = resolve;
    });

    delayedClient.middlewareStack.add(
      (next, context) => async (args) => {
        if (context.commandName === 'SendMessageCommand') {
          signalSendStarted();
          await sendReleased;
        }

        return next(args);
      },
      { step: 'initialize', name: 'delayOutboxSendDuringShutdown' },
    );

    const publisher = new OutboxPublisherWorker(
      orm.em,
      delayedClient,
      getWagerEventsQueueUrl(),
      1,
    );
    const publishing = publisher.runOnce();
    await sendStarted;
    let shutdownCompleted = false;
    const shutdown = publisher.onModuleDestroy().then(() => {
      shutdownCompleted = true;
    });

    await Bun.sleep(10);
    expect(shutdownCompleted).toBe(false);

    releaseSend();
    await Promise.all([publishing, shutdown]);
    delayedClient.destroy();

    const persisted = (await orm.em.fork().find(OutboxMessageOrmEntity, {}))[0];
    expect(shutdownCompleted).toBe(true);
    expect(persisted?.publishedAt).toBeInstanceOf(Date);
  });
});
