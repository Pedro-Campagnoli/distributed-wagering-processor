import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import type { EntityManager } from '@mikro-orm/postgresql';

import {
  ProcessWagerTransactionUseCase,
  type ProcessWagerTransactionOutput,
} from '../../application/use-cases/process-wager-transaction.use-case.js';
import { Money } from '../../domain/money.js';
import type { WagerTransactionMessage } from './wager-transaction.producer.js';

const POLL_INTERVAL_MS = 1_000;

export class WagerTransactionConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WagerTransactionConsumer.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly entityManager: EntityManager,
    private readonly sqsClient: SQSClient,
    private readonly queueUrl: string,
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
        VisibilityTimeout: 30,
      }),
    );
    const message = response.Messages?.[0];

    if (!message?.Body || !message.ReceiptHandle) {
      return;
    }

    const payload = JSON.parse(message.Body) as WagerTransactionMessage;
    const result = await new ProcessWagerTransactionUseCase(
      this.entityManager.fork(),
    ).execute({
      ...payload,
      money: Money.from(payload.money),
    });

    await this.sqsClient.send(
      new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: message.ReceiptHandle,
      }),
    );

    return result;
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
