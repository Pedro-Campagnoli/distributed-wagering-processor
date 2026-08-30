import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import type { EntityManager } from '@mikro-orm/postgresql';

import { ProcessInboxWagerMessageUseCase } from '../../application/use-cases/process-inbox-wager-message.use-case.js';
import type { ProcessWagerTransactionOutput } from '../../application/use-cases/process-wager-transaction.use-case.js';

const POLL_INTERVAL_MS = 1_000;
export const WAGER_TRANSACTION_CONSUMER_NAME = 'wager-transactions-consumer';

export class WagerTransactionConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WagerTransactionConsumer.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly entityManager: EntityManager,
    private readonly sqsClient: SQSClient,
    private readonly queueUrl: string,
    private readonly visibilityTimeoutSeconds = 30,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async runOnce(): Promise<ProcessWagerTransactionOutput | undefined> {
    const response = await this.sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 1,
        VisibilityTimeout: this.visibilityTimeoutSeconds,
      }),
    );
    const message = response.Messages?.[0];

    if (!message?.MessageId || !message.Body || !message.ReceiptHandle) {
      return;
    }

    const processing = await new ProcessInboxWagerMessageUseCase(
      this.entityManager,
    ).execute({
      consumerName: WAGER_TRANSACTION_CONSUMER_NAME,
      messageId: message.MessageId,
      body: message.Body,
    });

    await this.sqsClient.send(
      new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: message.ReceiptHandle,
      }),
    );

    return processing.result;
  }

  private async tick(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    try {
      await this.runOnce();
    } catch (error) {
      this.logger.error(error instanceof Error ? error.stack : String(error));
    } finally {
      this.running = false;
    }
  }
}
