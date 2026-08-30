import { randomUUID } from 'node:crypto';

import {
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
import { WagerTransactionConsumer } from '../src/wagering/infrastructure/messaging/wager-transaction.consumer.js';
import { WagerTransactionProducer } from '../src/wagering/infrastructure/messaging/wager-transaction.producer.js';
import { WagerTransactionOrmEntity } from '../src/wagering/infrastructure/persistence/entities/wager-transaction.orm-entity.js';
import { WalletLedgerEntryOrmEntity } from '../src/wagering/infrastructure/persistence/entities/wallet-ledger-entry.orm-entity.js';
import { WalletOrmEntity } from '../src/wagering/infrastructure/persistence/entities/wallet.orm-entity.js';
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

describe('LocalStack SQS wagering flow', () => {
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
    await orm.schema.clear({ truncate: true });
  });

  afterAll(async () => {
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

  it('delegates a queued BET to the use case and acknowledges it after processing', async () => {
    await openWalletFixture(orm, WALLET_ID, PLAYER_ID);

    const externalTransactionId = `sqs-bet-${randomUUID()}`;
    const messageId = await producer.send({
      providerId: 'provider-sqs',
      externalTransactionId,
      idempotencyKey: `provider-sqs:${externalTransactionId}`,
      payloadHash: `hash:${externalTransactionId}`,
      walletId: WALLET_ID,
      playerId: PLAYER_ID,
      roundId: 'round-sqs',
      gameId: 'game-sqs',
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: '25.00', currency: 'BRL' }),
    });

    const result = await consumer.runOnce();
    const entityManager = orm.em.fork();
    const [wallet, wagerTransactions, ledgerEntries, remainingMessages] =
      await Promise.all([
        entityManager.findOne(WalletOrmEntity, WALLET_ID),
        entityManager.find(WagerTransactionOrmEntity, {
          walletId: WALLET_ID,
          kind: WagerTransactionKind.Bet,
        }),
        entityManager.find(WalletLedgerEntryOrmEntity, {
          walletId: WALLET_ID,
        }),
        sqsClient.send(
          new ReceiveMessageCommand({
            QueueUrl: getWagerQueueUrl(),
            MaxNumberOfMessages: 1,
            WaitTimeSeconds: 1,
          }),
        ),
      ]);
    const debitEntries = ledgerEntries.filter(
      (entry) => entry.direction === LedgerDirection.Debit,
    );

    expect(messageId).toBeDefined();
    expect(result?.transaction.status).toBe(WagerTransactionStatus.Processed);
    expect(result?.observedBalance?.toJSON().amount).toBe('75.00');
    expect(wallet?.balance).toBe('75.00');
    expect(wagerTransactions).toHaveLength(1);
    expect(wagerTransactions[0]?.externalTransactionId).toBe(
      externalTransactionId,
    );
    expect(debitEntries).toHaveLength(1);
    expect(debitEntries[0]?.amount).toBe('25.00');
    expect(remainingMessages.Messages).toBeUndefined();
    expectWalletBalanceMatchesLedger(wallet, ledgerEntries);
  });
});
