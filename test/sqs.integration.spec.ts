import { randomUUID } from 'node:crypto';

import {
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
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
import {
  DuplicateInboxMessageConflictError,
  ProcessInboxWagerMessageUseCase,
  type ProcessInboxWagerMessageInput,
} from '../src/wagering/application/use-cases/process-inbox-wager-message.use-case.js';
import type { ProcessWagerTransactionInput } from '../src/wagering/application/use-cases/process-wager-transaction.use-case.js';
import { Money } from '../src/wagering/domain/money.js';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../src/wagering/domain/wager-transaction.js';
import { LedgerDirection } from '../src/wagering/domain/wallet-ledger-entry.js';
import {
  createSqsClient,
  getWagerDlqUrl,
  getWagerQueueUrl,
} from '../src/wagering/infrastructure/messaging/sqs-client.js';
import {
  WAGER_TRANSACTION_CONSUMER_NAME,
  WagerTransactionConsumer,
} from '../src/wagering/infrastructure/messaging/wager-transaction.consumer.js';
import { WagerTransactionProducer } from '../src/wagering/infrastructure/messaging/wager-transaction.producer.js';
import {
  createWagerTransactionMessage,
  WAGER_TRANSACTION_REQUESTED,
} from '../src/wagering/infrastructure/messaging/wager-transaction.message.js';
import { InboxMessageOrmEntity } from '../src/wagering/infrastructure/persistence/entities/inbox-message.orm-entity.js';
import { OutboxMessageOrmEntity } from '../src/wagering/infrastructure/persistence/entities/outbox-message.orm-entity.js';
import { WagerTransactionOrmEntity } from '../src/wagering/infrastructure/persistence/entities/wager-transaction.orm-entity.js';
import { WalletLedgerEntryOrmEntity } from '../src/wagering/infrastructure/persistence/entities/wallet-ledger-entry.orm-entity.js';
import { WalletOrmEntity } from '../src/wagering/infrastructure/persistence/entities/wallet.orm-entity.js';
import { MikroOrmInboxMessageRepository } from '../src/wagering/infrastructure/persistence/repositories/mikro-orm-inbox-message.repository.js';
import {
  expectWalletBalanceMatchesLedger,
  openWalletFixture,
} from './support/financial-fixture.js';

const WALLET_ID = '00000000-0000-4000-8000-000000001701';
const PLAYER_ID = '00000000-0000-4000-8000-000000001702';

let orm: MikroORM;
let sqsClient: SQSClient;
let producer: WagerTransactionProducer;
let consumer: WagerTransactionConsumer;

function createInput(amount = '25.00'): ProcessWagerTransactionInput {
  const externalTransactionId = `sqs-bet-${randomUUID()}`;

  return {
    providerId: 'provider-sqs',
    externalTransactionId,
    idempotencyKey: `provider-sqs:${externalTransactionId}`,
    walletId: WALLET_ID,
    playerId: PLAYER_ID,
    roundId: 'round-sqs',
    gameId: 'game-sqs',
    kind: WagerTransactionKind.Bet,
    money: Money.from({ amount, currency: 'BRL' }),
  };
}

function createInboxInput(
  messageId: string,
  input: ProcessWagerTransactionInput,
): ProcessInboxWagerMessageInput {
  return {
    consumerName: WAGER_TRANSACTION_CONSUMER_NAME,
    body: JSON.stringify(
      createWagerTransactionMessage(
        input,
        messageId,
        new Date('2026-01-01T00:00:00.000Z'),
      ),
    ),
  };
}

async function drainQueue(queueUrl: string): Promise<void> {
  while (true) {
    const response = await sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
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
            QueueUrl: queueUrl,
            ReceiptHandle: message.ReceiptHandle!,
          }),
        ),
      ),
    );
  }
}

async function receiveOne(queueUrl: string, waitTimeSeconds = 0) {
  return sqsClient.send(
    new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: waitTimeSeconds,
      VisibilityTimeout: 30,
    }),
  );
}

async function persistedFinancialState() {
  const entityManager = orm.em.fork();
  const [
    wallet,
    wagerTransactions,
    ledgerEntries,
    inboxMessages,
    outboxMessages,
  ] = await Promise.all([
    entityManager.findOne(WalletOrmEntity, WALLET_ID),
    entityManager.find(WagerTransactionOrmEntity, {
      walletId: WALLET_ID,
      kind: WagerTransactionKind.Bet,
    }),
    entityManager.find(WalletLedgerEntryOrmEntity, {
      walletId: WALLET_ID,
    }),
    entityManager.find(InboxMessageOrmEntity, {
      consumerName: WAGER_TRANSACTION_CONSUMER_NAME,
    }),
    entityManager.find(OutboxMessageOrmEntity, {}),
  ]);

  return {
    wallet,
    wagerTransactions,
    ledgerEntries,
    inboxMessages,
    outboxMessages,
  };
}

function wagerOutboxCount(
  state: Awaited<ReturnType<typeof persistedFinancialState>>,
) {
  const transactionIds = new Set(
    state.wagerTransactions.map((transaction) => transaction.id),
  );

  return state.outboxMessages.filter((message) =>
    transactionIds.has(
      (message.payload.data as { transactionId?: string }).transactionId ?? '',
    ),
  ).length;
}

describe('LocalStack SQS wagering flow with persistent Inbox', () => {
  beforeAll(async () => {
    orm = await MikroORM.init(mikroOrmConfig);
    sqsClient = createSqsClient();
    producer = new WagerTransactionProducer(sqsClient, getWagerQueueUrl());
    consumer = new WagerTransactionConsumer(
      orm.em,
      sqsClient,
      getWagerQueueUrl(),
    );
  });

  beforeEach(async () => {
    await Promise.all([
      drainQueue(getWagerQueueUrl()),
      drainQueue(getWagerDlqUrl()),
    ]);
    await orm.schema.clear({ truncate: true });
  });

  afterAll(async () => {
    await Promise.all([
      drainQueue(getWagerQueueUrl()),
      drainQueue(getWagerDlqUrl()),
    ]);
    await orm.schema.clear({ truncate: true });
    await orm.close(true);
    sqsClient.destroy();
  });

  it('exposes the FIFO queue and its redrive policy to the FIFO DLQ', async () => {
    const [queue, dlq] = await Promise.all([
      sqsClient.send(
        new GetQueueAttributesCommand({
          QueueUrl: getWagerQueueUrl(),
          AttributeNames: ['QueueArn', 'FifoQueue', 'RedrivePolicy'],
        }),
      ),
      sqsClient.send(
        new GetQueueAttributesCommand({
          QueueUrl: getWagerDlqUrl(),
          AttributeNames: ['QueueArn', 'FifoQueue'],
        }),
      ),
    ]);
    const redrivePolicy = JSON.parse(
      queue.Attributes?.RedrivePolicy ?? '{}',
    ) as {
      deadLetterTargetArn?: string;
      maxReceiveCount?: string;
    };

    expect(queue.Attributes?.FifoQueue).toBe('true');
    expect(dlq.Attributes?.FifoQueue).toBe('true');
    expect(redrivePolicy.deadLetterTargetArn).toBe(dlq.Attributes?.QueueArn);
    expect(redrivePolicy.maxReceiveCount).toBe('3');
  });

  it('persists Inbox and delegates a queued BET to the financial use case', async () => {
    await openWalletFixture(orm, WALLET_ID, PLAYER_ID);
    const input = createInput();
    const messageId = await producer.send(input);

    const result = await consumer.runOnce();
    const state = await persistedFinancialState();
    const remainingMessages = await receiveOne(getWagerQueueUrl(), 1);
    const inbox = state.inboxMessages.find(
      (message) => message.messageId === messageId,
    );
    const debitEntries = state.ledgerEntries.filter(
      (entry) => entry.direction === LedgerDirection.Debit,
    );

    expect(messageId).toBeDefined();
    expect(result?.transaction.status).toBe(WagerTransactionStatus.Processed);
    expect(result?.observedBalance?.toJSON().amount).toBe('75.00');
    expect(inbox?.consumerName).toBe(WAGER_TRANSACTION_CONSUMER_NAME);
    expect(inbox?.payloadHash).toHaveLength(64);
    expect(inbox?.receivedAt).toBeInstanceOf(Date);
    expect(inbox?.processedAt).toBeInstanceOf(Date);
    expect(state.wallet?.balance).toBe('75.00');
    expect(state.wagerTransactions).toHaveLength(1);
    expect(debitEntries).toHaveLength(1);
    expect(debitEntries[0]?.amount).toBe('25.00');
    expect(wagerOutboxCount(state)).toBe(2);
    expect(remainingMessages.Messages).toBeUndefined();
    expectWalletBalanceMatchesLedger(state.wallet, state.ledgerEntries);
  });

  it('publishes the required envelope without accepting a caller payload hash', async () => {
    const input = createInput() as ProcessWagerTransactionInput & {
      payloadHash: string;
    };
    input.payloadHash = 'untrusted-caller-hash';
    const logicalMessageId = await producer.send(input);
    const response = await receiveOne(getWagerQueueUrl(), 1);
    const body = JSON.parse(response.Messages?.[0]?.Body ?? '{}') as {
      messageId?: string;
      type?: string;
      occurredAt?: string;
      data?: Record<string, unknown>;
    };

    expect(body.messageId).toBe(logicalMessageId);
    expect(body.type).toBe(WAGER_TRANSACTION_REQUESTED);
    expect(Date.parse(body.occurredAt ?? '')).not.toBeNaN();
    expect(body.data?.externalTransactionId).toBe(input.externalTransactionId);
    expect(body.data?.payloadHash).toBeUndefined();

    await sqsClient.send(
      new DeleteMessageCommand({
        QueueUrl: getWagerQueueUrl(),
        ReceiptHandle: response.Messages?.[0]?.ReceiptHandle,
      }),
    );
  });

  it('commits a terminal business rejection and acknowledges the message', async () => {
    await openWalletFixture(orm, WALLET_ID, PLAYER_ID);
    const messageId = await producer.send(createInput('150.00'));

    const result = await consumer.runOnce();
    const state = await persistedFinancialState();
    const remainingMessages = await receiveOne(getWagerQueueUrl(), 1);
    const inbox = state.inboxMessages.find(
      (message) => message.messageId === messageId,
    );
    const debitEntries = state.ledgerEntries.filter(
      (entry) => entry.direction === LedgerDirection.Debit,
    );

    expect(result?.transaction.status).toBe(WagerTransactionStatus.Rejected);
    expect(result?.transaction.failureCode).toBe('INSUFFICIENT_BALANCE');
    expect(inbox?.processedAt).toBeInstanceOf(Date);
    expect(state.wallet?.balance).toBe('100.00');
    expect(state.wagerTransactions).toHaveLength(1);
    expect(debitEntries).toHaveLength(0);
    expect(wagerOutboxCount(state)).toBe(1);
    expect(remainingMessages.Messages).toBeUndefined();
    expectWalletBalanceMatchesLedger(state.wallet, state.ledgerEntries);
  });

  it('acknowledges an idempotency conflict instead of retrying it', async () => {
    await openWalletFixture(orm, WALLET_ID, PLAYER_ID);
    const first = createInput('25.00');
    const conflicting = {
      ...first,
      money: Money.from({ amount: '30.00', currency: 'BRL' }),
    };

    await producer.send(first);
    await consumer.runOnce();
    await producer.send(conflicting);
    const conflictResult = await consumer.runOnce();

    const state = await persistedFinancialState();
    const remainingMessages = await receiveOne(getWagerQueueUrl(), 1);
    const debits = state.ledgerEntries.filter(
      (entry) => entry.direction === LedgerDirection.Debit,
    );

    expect(conflictResult).toBeUndefined();
    expect(remainingMessages.Messages).toBeUndefined();
    expect(state.wallet?.balance).toBe('75.00');
    expect(state.wagerTransactions).toHaveLength(1);
    expect(debits).toHaveLength(1);
    expectWalletBalanceMatchesLedger(state.wallet, state.ledgerEntries);
  });

  it('rolls back Inbox and the financial effect when Inbox finalization fails', async () => {
    await openWalletFixture(orm, WALLET_ID, PLAYER_ID);
    const messageId = `atomic-inbox-${randomUUID()}`;
    const processor = new ProcessInboxWagerMessageUseCase(orm.em);
    const originalMarkProcessed =
      MikroOrmInboxMessageRepository.prototype.markProcessed;

    MikroOrmInboxMessageRepository.prototype.markProcessed = async () => {
      throw new Error('Simulated Inbox finalization failure');
    };

    try {
      await expect(
        processor.execute(createInboxInput(messageId, createInput())),
      ).rejects.toThrow('Simulated Inbox finalization failure');
    } finally {
      MikroOrmInboxMessageRepository.prototype.markProcessed =
        originalMarkProcessed;
    }

    const state = await persistedFinancialState();
    const inbox = state.inboxMessages.find(
      (message) => message.messageId === messageId,
    );
    const debitEntries = state.ledgerEntries.filter(
      (entry) => entry.direction === LedgerDirection.Debit,
    );

    expect(inbox).toBeUndefined();
    expect(state.wallet?.balance).toBe('100.00');
    expect(state.wagerTransactions).toHaveLength(0);
    expect(debitEntries).toHaveLength(0);
    expect(wagerOutboxCount(state)).toBe(0);
    expectWalletBalanceMatchesLedger(state.wallet, state.ledgerEntries);
  });

  it('leaves a transient infrastructure failure unacknowledged for redelivery', async () => {
    await openWalletFixture(orm, WALLET_ID, PLAYER_ID);
    const messageId = await producer.send(createInput());
    const originalMarkProcessed =
      MikroOrmInboxMessageRepository.prototype.markProcessed;
    const immediateRetryConsumer = new WagerTransactionConsumer(
      orm.em,
      sqsClient,
      getWagerQueueUrl(),
      1,
    );

    MikroOrmInboxMessageRepository.prototype.markProcessed = async () => {
      throw new Error('Simulated transient database failure');
    };

    try {
      await expect(immediateRetryConsumer.runOnce()).rejects.toThrow(
        'Simulated transient database failure',
      );
    } finally {
      MikroOrmInboxMessageRepository.prototype.markProcessed =
        originalMarkProcessed;
    }

    await Bun.sleep(1_050);
    const retryResult = await immediateRetryConsumer.runOnce();
    const state = await persistedFinancialState();

    expect(retryResult?.transaction.status).toBe(
      WagerTransactionStatus.Processed,
    );
    expect(state.inboxMessages[0]?.messageId).toBe(messageId);
    expect(state.wallet?.balance).toBe('75.00');
    expect(state.wagerTransactions).toHaveLength(1);
    expectWalletBalanceMatchesLedger(state.wallet, state.ledgerEntries);
  });

  it('deduplicates redelivery after commit when the first ACK fails', async () => {
    await openWalletFixture(orm, WALLET_ID, PLAYER_ID);
    const input = createInput();
    const messageId = await producer.send(input);
    const deleteFailingClient = createSqsClient();
    let failDelete = true;

    deleteFailingClient.middlewareStack.add(
      (next, context) => async (args) => {
        if (context.commandName === 'DeleteMessageCommand' && failDelete) {
          failDelete = false;
          throw new Error('Simulated ACK failure after commit');
        }

        return next(args);
      },
      { step: 'initialize', name: 'failFirstDeleteAfterCommit' },
    );

    const deleteFailingConsumer = new WagerTransactionConsumer(
      orm.em,
      deleteFailingClient,
      getWagerQueueUrl(),
      0,
    );

    await expect(deleteFailingConsumer.runOnce()).rejects.toThrow(
      'Simulated ACK failure after commit',
    );
    deleteFailingClient.destroy();

    const committedState = await persistedFinancialState();

    expect(committedState.wallet?.balance).toBe('75.00');
    expect(committedState.wagerTransactions).toHaveLength(1);
    expect(committedState.inboxMessages).toHaveLength(1);
    expect(committedState.inboxMessages[0]?.messageId).toBe(messageId);
    expect(committedState.inboxMessages[0]?.processedAt).toBeInstanceOf(Date);

    const replayResult = await consumer.runOnce();
    const finalState = await persistedFinancialState();
    const remainingMessages = await receiveOne(getWagerQueueUrl(), 1);
    const debitEntries = finalState.ledgerEntries.filter(
      (entry) => entry.direction === LedgerDirection.Debit,
    );

    expect(replayResult).toBeUndefined();
    expect(finalState.wallet?.balance).toBe('75.00');
    expect(finalState.wagerTransactions).toHaveLength(1);
    expect(finalState.inboxMessages).toHaveLength(1);
    expect(debitEntries).toHaveLength(1);
    expect(wagerOutboxCount(finalState)).toBe(2);
    expect(remainingMessages.Messages).toBeUndefined();
    expectWalletBalanceMatchesLedger(
      finalState.wallet,
      finalState.ledgerEntries,
    );
  });

  it('rejects a reused logical message id with a different payload', async () => {
    await openWalletFixture(orm, WALLET_ID, PLAYER_ID);
    const messageId = `logical-conflict-${randomUUID()}`;
    const processor = new ProcessInboxWagerMessageUseCase(orm.em);

    await processor.execute(createInboxInput(messageId, createInput('25.00')));

    await expect(
      processor.execute(createInboxInput(messageId, createInput('30.00'))),
    ).rejects.toBeInstanceOf(DuplicateInboxMessageConflictError);

    const state = await persistedFinancialState();
    const debits = state.ledgerEntries.filter(
      (entry) => entry.direction === LedgerDirection.Debit,
    );

    expect(state.inboxMessages).toHaveLength(1);
    expect(state.wagerTransactions).toHaveLength(1);
    expect(debits).toHaveLength(1);
    expect(state.wallet?.balance).toBe('75.00');
    expectWalletBalanceMatchesLedger(state.wallet, state.ledgerEntries);
  });

  it('treats reordered canonical JSON as the same Inbox payload', async () => {
    await openWalletFixture(orm, WALLET_ID, PLAYER_ID);
    const processor = new ProcessInboxWagerMessageUseCase(orm.em);
    const message = createWagerTransactionMessage(
      createInput(),
      `canonical-${randomUUID()}`,
      new Date('2026-01-01T00:00:00.000Z'),
    );
    const first = await processor.execute({
      consumerName: WAGER_TRANSACTION_CONSUMER_NAME,
      body: JSON.stringify(message),
    });
    const replay = await processor.execute({
      consumerName: WAGER_TRANSACTION_CONSUMER_NAME,
      body: JSON.stringify({
        data: message.data,
        occurredAt: message.occurredAt,
        type: message.type,
        messageId: message.messageId,
      }),
    });
    const state = await persistedFinancialState();

    expect(first.alreadyProcessed).toBe(false);
    expect(replay.alreadyProcessed).toBe(true);
    expect(state.inboxMessages).toHaveLength(1);
    expect(state.wagerTransactions).toHaveLength(1);
    expect(state.wallet?.balance).toBe('75.00');
  });

  it('waits for the in-flight ACK during graceful shutdown', async () => {
    await openWalletFixture(orm, WALLET_ID, PLAYER_ID);
    await producer.send(createInput());
    const delayedClient = createSqsClient();
    let releaseDelete!: () => void;
    let signalDeleteStarted!: () => void;
    const deleteReleased = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    const deleteStarted = new Promise<void>((resolve) => {
      signalDeleteStarted = resolve;
    });

    delayedClient.middlewareStack.add(
      (next, context) => async (args) => {
        if (context.commandName === 'DeleteMessageCommand') {
          signalDeleteStarted();
          await deleteReleased;
        }

        return next(args);
      },
      { step: 'initialize', name: 'delayDeleteDuringShutdown' },
    );

    const shuttingDownConsumer = new WagerTransactionConsumer(
      orm.em,
      delayedClient,
      getWagerQueueUrl(),
      30,
    );
    const processing = shuttingDownConsumer.runOnce();
    await deleteStarted;
    let shutdownCompleted = false;
    const shutdown = shuttingDownConsumer.onModuleDestroy().then(() => {
      shutdownCompleted = true;
    });

    await Bun.sleep(10);
    expect(shutdownCompleted).toBe(false);

    releaseDelete();
    await Promise.all([processing, shutdown]);
    delayedClient.destroy();

    expect(shutdownCompleted).toBe(true);
    expect((await receiveOne(getWagerQueueUrl(), 1)).Messages).toBeUndefined();
  });

  it('lets SQS move a repeatedly failing message to the DLQ', async () => {
    const poisonBody = `invalid-json-${randomUUID()}`;
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: getWagerQueueUrl(),
        MessageBody: poisonBody,
        MessageGroupId: `poison-${randomUUID()}`,
      }),
    );
    const immediateRetryConsumer = new WagerTransactionConsumer(
      orm.em,
      sqsClient,
      getWagerQueueUrl(),
      0,
    );

    let failedReceives = 0;
    let dlqMessage:
      { Body?: string; ReceiptHandle?: string; MessageId?: string } | undefined;

    for (let attempt = 0; attempt < 6 && !dlqMessage; attempt++) {
      try {
        await immediateRetryConsumer.runOnce();
      } catch {
        failedReceives++;
      }

      const dlqResponse = await receiveOne(getWagerDlqUrl());
      dlqMessage = dlqResponse.Messages?.[0];
    }

    expect(failedReceives).toBe(3);
    expect(dlqMessage?.Body).toBe(poisonBody);

    await sqsClient.send(
      new DeleteMessageCommand({
        QueueUrl: getWagerDlqUrl(),
        ReceiptHandle: dlqMessage?.ReceiptHandle,
      }),
    );

    const entityManager = orm.em.fork();
    const [inboxCount, sourceMessages] = await Promise.all([
      entityManager.count(InboxMessageOrmEntity, {}),
      receiveOne(getWagerQueueUrl(), 1),
    ]);

    expect(inboxCount).toBe(0);
    expect(sourceMessages.Messages).toBeUndefined();
  });
});
