import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  MessageSystemAttributeName,
  ReceiveMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import type { EntityManager } from '@mikro-orm/postgresql';
import { DeadlockException, LockWaitTimeoutException } from '@mikro-orm/core';

import {
  DuplicateInboxMessageConflictError,
  ProcessInboxWagerMessageUseCase,
} from '../../application/use-cases/process-inbox-wager-message.use-case.js';
import type { ProcessWagerTransactionOutput } from '../../application/use-cases/process-wager-transaction.use-case.js';
import { IdempotencyConflictError } from '../../domain/errors.js';
import {
  parseWagerTransactionMessage,
  type WagerTransactionMessage,
} from './wager-transaction.message.js';
import {
  OperationalMetrics,
  operationalMetrics,
} from '../observability/operational-metrics.js';

const POLL_INTERVAL_MS = 1_000;
const MAX_SQS_VISIBILITY_TIMEOUT_SECONDS = 43_200;
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
    private readonly metrics: OperationalMetrics = operationalMetrics,
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
        MessageSystemAttributeNames: [
          MessageSystemAttributeName.ApproximateReceiveCount,
        ],
      }),
    );
    const message = response.Messages?.[0];

    if (!message?.Body || !message.ReceiptHandle) {
      return;
    }

    const startedAt = performance.now();
    let envelope: WagerTransactionMessage | undefined;
    let processing;

    try {
      envelope = parseWagerTransactionMessage(message.Body);
      processing = await new ProcessInboxWagerMessageUseCase(
        this.entityManager,
      ).execute({
        consumerName: WAGER_TRANSACTION_CONSUMER_NAME,
        body: message.Body,
      });
    } catch (error) {
      this.metrics.recordRetry();

      if (error instanceof DuplicateInboxMessageConflictError) {
        this.metrics.recordDuplicate();
      }

      if (
        error instanceof LockWaitTimeoutException ||
        error instanceof DeadlockException
      ) {
        this.metrics.recordLockConflict();
      }

      this.logMessage('wager_message_retry', envelope, error);
      await this.scheduleRetry(
        message.ReceiptHandle,
        message.Attributes?.ApproximateReceiveCount,
      );
      throw error;
    } finally {
      this.metrics.recordProcessingLatency(performance.now() - startedAt);
    }

    if (processing.terminalError) {
      if (processing.terminalError instanceof IdempotencyConflictError) {
        this.metrics.recordDuplicate();
      }

      this.logMessage(
        'wager_message_terminal_error',
        envelope,
        processing.terminalError,
      );
      await this.deleteMessage(message.ReceiptHandle);
      return;
    }

    if (processing.alreadyProcessed || processing.result?.idempotentReplay) {
      this.metrics.recordDuplicate();
    }

    if (processing.result) {
      this.metrics.recordTransaction(processing.result.transaction.status);
    }

    this.logMessage(
      'wager_message_processed',
      envelope,
      undefined,
      processing.result?.transaction.id,
    );
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

  private async scheduleRetry(
    receiptHandle: string,
    approximateReceiveCount: string | undefined,
  ): Promise<void> {
    const receiveCount = Math.max(
      1,
      Number.parseInt(approximateReceiveCount ?? '1', 10) || 1,
    );
    const baseDelay = Math.max(
      0,
      Number.parseInt(
        process.env.SQS_RETRY_BASE_DELAY_SECONDS ??
          String(this.visibilityTimeoutSeconds),
        10,
      ) || 0,
    );
    const visibilityTimeout = Math.min(
      baseDelay * 2 ** (receiveCount - 1),
      MAX_SQS_VISIBILITY_TIMEOUT_SECONDS,
    );

    await this.sqsClient.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: visibilityTimeout,
      }),
    );
  }

  private logMessage(
    event: string,
    envelope: WagerTransactionMessage | undefined,
    error?: unknown,
    transactionId?: string,
  ): void {
    this.logger.log(
      JSON.stringify({
        event,
        correlationId: envelope?.messageId,
        messageId: envelope?.messageId,
        transactionId,
        walletId: envelope?.data.walletId,
        providerId: envelope?.data.providerId,
        errorName: error instanceof Error ? error.name : undefined,
      }),
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
      this.logger.error(
        JSON.stringify({
          event: 'wager_consumer_poll_failed',
          errorName: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
    } finally {
      this.running = false;
    }
  }
}
