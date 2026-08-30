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
import {
  IdempotencyConflictError,
  WalletPlayerMismatchError,
} from '../../domain/errors.js';

const POLL_INTERVAL_MS = 1_000;
export const WAGER_TRANSACTION_CONSUMER_NAME = 'wager-transactions-consumer';

export class WagerTransactionConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WagerTransactionConsumer.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private stopping = false;
  private inFlight?: Promise<ProcessWagerTransactionOutput | undefined>;

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

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;

    if (this.timer) {
      clearInterval(this.timer);
    }

    await this.inFlight?.catch(() => undefined);
  }

  async runOnce(): Promise<ProcessWagerTransactionOutput | undefined> {
    if (this.stopping) {
      return;
    }

    if (this.inFlight) {
      return this.inFlight;
    }

    const execution = this.receiveAndProcess();
    this.inFlight = execution;

    try {
      return await execution;
    } finally {
      if (this.inFlight === execution) {
        this.inFlight = undefined;
      }
    }
  }

  private async receiveAndProcess(): Promise<
    ProcessWagerTransactionOutput | undefined
  > {
    const response = await this.sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 1,
        VisibilityTimeout: this.visibilityTimeoutSeconds,
      }),
    );
    const message = response.Messages?.[0];

    if (!message?.Body || !message.ReceiptHandle) {
      return;
    }

    let processing;

    try {
      processing = await new ProcessInboxWagerMessageUseCase(
        this.entityManager,
      ).execute({
        consumerName: WAGER_TRANSACTION_CONSUMER_NAME,
        body: message.Body,
      });
    } catch (error) {
      if (!this.isTerminalBusinessError(error)) {
        throw error;
      }

      await this.deleteMessage(message.ReceiptHandle);
      return;
    }

    await this.deleteMessage(message.ReceiptHandle);

    return processing.result;
  }

  private async deleteMessage(receiptHandle: string): Promise<void> {
    await this.sqsClient.send(
      new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
      }),
    );
  }

  private isTerminalBusinessError(error: unknown): boolean {
    return (
      error instanceof IdempotencyConflictError ||
      error instanceof WalletPlayerMismatchError
    );
  }

  private async tick(): Promise<void> {
    if (this.running || this.stopping) {
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
